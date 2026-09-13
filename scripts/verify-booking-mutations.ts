import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { BookingCapabilities, BookingRules, Lesson, Reservation, User } from "../src/lib/domain";
import {
  availablePlacesForLesson,
  canCancelLessonAt,
  cancellationPolicyForLesson,
  freeCancellationDeadlineForLesson,
} from "../src/lib/bookingRules";
import { parseExplicitLuxartDateTime } from "../src/lib/luxartContract";
import { luxartResourceMappingSha256 } from "../src/lib/luxartResourceMappingFingerprint";
import { isBoundedKcAmount, maximumOperationalAmountKc } from "../src/lib/moneyBounds";

type FetchLike = typeof fetch;
type Environment = Record<string, string | undefined>;
type BookingMutationUatPhase = "booking_without_payments" | "booking_with_stripe";

interface Snapshot {
  user: User;
  lessons: Lesson[];
  reservations: Reservation[];
  rules: BookingRules;
  capabilities: BookingCapabilities;
}

export interface BookingMutationUatConfig {
  target: URL;
  expectedCommit: string;
  expectedPhase: BookingMutationUatPhase;
  expectedResourceMapSha256: string;
  login: string;
  password: string;
  memberCardNumber?: string;
  expectedUserId: string;
  lessonId: string;
  expectedCancellationFeeKc: number;
  minimumHoursBeforeStart: number;
  timeoutMs: number;
}

interface ApiResult<T> {
  body: T;
  status: number;
  requestId: string;
  setCookie?: string;
}

class UatApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId: string,
    message: string,
  ) {
    super(message);
  }
}

function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function exactInteger(
  environment: Environment,
  name: string,
  minimum = 0,
  maximum = maximumOperationalAmountKc,
) {
  const value = Number(required(environment, name));
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function loadBookingMutationUatConfig(environment: Environment = process.env): BookingMutationUatConfig {
  const target = new URL(required(environment, "ZONE4YOU_UAT_APP_URL"));
  if (target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
    throw new Error("ZONE4YOU_UAT_APP_URL must be a clean origin ending in / without credentials, query or hash.");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(target.hostname);
  if (target.protocol !== "https:" && !(local && environment.ZONE4YOU_UAT_ALLOW_LOCAL_HTTP === "true")) {
    throw new Error("Mutation UAT requires HTTPS; local HTTP needs ZONE4YOU_UAT_ALLOW_LOCAL_HTTP=true.");
  }
  if (target.origin === "https://booking.zone4you.cz") {
    throw new Error("Mutation UAT refuses the production booking.zone4you.cz origin.");
  }
  if (!local && !target.hostname.includes("staging") && !target.hostname.endsWith(".vercel.app")) {
    throw new Error("Mutation UAT accepts only a local, staging-named or Vercel preview hostname.");
  }
  const expectedConfirmation = `ZONE4YOU_TEST_DB_ONLY:${target.origin}`;
  if (environment.ZONE4YOU_UAT_MUTATION_CONFIRMATION !== expectedConfirmation) {
    throw new Error(`ZONE4YOU_UAT_MUTATION_CONFIRMATION must exactly equal ${expectedConfirmation}.`);
  }

  const expectedCommit = required(environment, "ZONE4YOU_UAT_EXPECTED_COMMIT").toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(expectedCommit)) {
    throw new Error("ZONE4YOU_UAT_EXPECTED_COMMIT must be a full 40-character Git SHA.");
  }
  const expectedPhase = required(environment, "ZONE4YOU_UAT_EXPECTED_PHASE");
  if (!(["booking_without_payments", "booking_with_stripe"] as string[]).includes(expectedPhase)) {
    throw new Error("ZONE4YOU_UAT_EXPECTED_PHASE must be booking_without_payments or booking_with_stripe.");
  }

  const minimumHoursBeforeStart = Number(environment.ZONE4YOU_UAT_MIN_HOURS_BEFORE_START ?? "6");
  const timeoutMs = Number(environment.ZONE4YOU_UAT_TIMEOUT_MS ?? "12000");
  if (!Number.isFinite(minimumHoursBeforeStart) || minimumHoursBeforeStart < 4) {
    throw new Error("ZONE4YOU_UAT_MIN_HOURS_BEFORE_START must be at least 4 hours.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    throw new Error("ZONE4YOU_UAT_TIMEOUT_MS must be an integer between 1000 and 30000.");
  }

  return {
    target,
    expectedCommit,
    expectedPhase: expectedPhase as BookingMutationUatPhase,
    expectedResourceMapSha256: luxartResourceMappingSha256(
      required(environment, "LUXART_RESOURCE_MAP_JSON"),
    ),
    login: required(environment, "ZONE4YOU_UAT_LOGIN"),
    password: required(environment, "ZONE4YOU_UAT_PASSWORD"),
    memberCardNumber: environment.ZONE4YOU_UAT_MEMBER_CARD_NUMBER?.trim() || undefined,
    expectedUserId: required(environment, "ZONE4YOU_UAT_EXPECTED_USER_ID"),
    lessonId: required(environment, "ZONE4YOU_UAT_LESSON_ID"),
    expectedCancellationFeeKc: exactInteger(environment, "ZONE4YOU_UAT_EXPECTED_CANCELLATION_FEE_KC"),
    minimumHoursBeforeStart,
    timeoutMs,
  };
}

function cookieFromSetCookie(setCookie: string | undefined) {
  const cookie = setCookie?.split(";", 1)[0]?.trim();
  if (!cookie?.startsWith("z4y_booking_session=")) throw new Error("Login did not return the signed booking session cookie.");
  return cookie;
}

function shortHash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

export function redactUatSecrets(message: string, environment: Environment = process.env) {
  return [
    environment.ZONE4YOU_UAT_LOGIN,
    environment.ZONE4YOU_UAT_PASSWORD,
    environment.ZONE4YOU_UAT_MEMBER_CARD_NUMBER,
  ].reduce<string>((safeMessage, secret) => {
    const value = secret?.trim();
    return value ? safeMessage.replaceAll(value, "[redacted]") : safeMessage;
  }, message);
}

async function api<T>(
  config: BookingMutationUatConfig,
  fetchImpl: FetchLike,
  path: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  const response = await fetchImpl(new URL(path, config.target), {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(config.timeoutMs),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: config.target.origin,
      "X-Zone4You-Locale": "cs",
      ...init.headers,
    },
  });
  const requestId = response.headers.get("x-request-id");
  if (!requestId) throw new Error(`${init.method ?? "GET"} ${path} did not return X-Request-ID.`);
  const body = (await response.json().catch(() => ({}))) as T & { code?: string; error?: string };
  if (!response.ok) {
    throw new UatApiError(
      response.status,
      body.code ?? "UNKNOWN_API_ERROR",
      requestId,
      body.error ?? `${init.method ?? "GET"} ${path} failed.`,
    );
  }
  return { body, status: response.status, requestId, setCookie: response.headers.get("set-cookie") ?? undefined };
}

async function authenticatedSnapshot(config: BookingMutationUatConfig, fetchImpl: FetchLike, cookie: string) {
  return api<Snapshot>(config, fetchImpl, "/api/booking/snapshot", {
    method: "POST",
    headers: { Cookie: cookie },
    body: "{}",
  });
}

function exactActiveReservation(snapshot: Snapshot, lessonId: string) {
  return snapshot.reservations.filter((reservation) => reservation.status === "active" && reservation.lessonId === lessonId);
}

function activeReservationIdentitySet(snapshot: Snapshot) {
  return snapshot.reservations
    .filter((reservation) => reservation.status === "active")
    .map((reservation) => `${reservation.id}\u0000${reservation.userId}\u0000${reservation.lessonId}`)
    .sort();
}

export function assertUatReservation(
  reservation: Reservation | undefined,
  config: BookingMutationUatConfig,
  expectedStatus: "active" | "cancelled",
  expectedId?: string,
) {
  const cancelledFinancialsAreValid = expectedStatus === "active" || (
    Boolean(parseExplicitLuxartDateTime(reservation?.cancelledAt)) &&
    isBoundedKcAmount(reservation?.cancellationFeeKc, 0)
  );
  if (
    !reservation ||
    reservation.userId !== config.expectedUserId ||
    reservation.lessonId !== config.lessonId ||
    reservation.status !== expectedStatus ||
    (expectedId !== undefined && reservation.id !== expectedId) ||
    !parseExplicitLuxartDateTime(reservation.reservedAt) ||
    !isBoundedKcAmount(reservation.priceKc, 0) ||
    !cancelledFinancialsAreValid
  ) {
    throw new Error(
      `Reservation response does not match the approved test user, lesson, financial bounds or ${expectedStatus} state.`,
    );
  }
}

async function reservationRequest(
  config: BookingMutationUatConfig,
  fetchImpl: FetchLike,
  cookie: string,
  idempotencyKey: string,
) {
  return api<{ reservation: Reservation }>(config, fetchImpl, "/api/reservations", {
    method: "POST",
    headers: { Cookie: cookie, "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ lessonId: config.lessonId }),
  });
}

async function cancellationRequest(
  config: BookingMutationUatConfig,
  fetchImpl: FetchLike,
  cookie: string,
  reservationId: string,
  idempotencyKey: string,
) {
  return api<{ reservation: Reservation }>(
    config,
    fetchImpl,
    `/api/reservations/${encodeURIComponent(reservationId)}`,
    {
      method: "DELETE",
      headers: { Cookie: cookie, "Idempotency-Key": idempotencyKey },
      body: "{}",
    },
  );
}

async function waitForSnapshot(
  config: BookingMutationUatConfig,
  fetchImpl: FetchLike,
  cookie: string,
  requestIds: string[],
  predicate: (snapshot: Snapshot) => boolean,
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await authenticatedSnapshot(config, fetchImpl, cookie);
    requestIds.push(result.requestId);
    const snapshot = result.body;
    if (predicate(snapshot)) return snapshot;
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Luxart state did not converge within the bounded read-only verification window.");
}

export async function runBookingMutationUat(config: BookingMutationUatConfig, fetchImpl: FetchLike = fetch) {
  const readiness = await api<{
    status?: string;
    mode?: string;
    phase?: string;
    commit?: string;
    region?: string;
    luxart?: string;
    schedule?: string;
    booking?: string;
    payments?: string;
    resourceMapSha256?: string;
    capabilities?: Partial<BookingCapabilities>;
  }>(config, fetchImpl, "/api/readiness");
  const noPayments = config.expectedPhase === "booking_without_payments";
  if (
    readiness.body.status !== "ready" ||
    readiness.body.mode !== "live" ||
    readiness.body.phase !== config.expectedPhase ||
    readiness.body.commit?.toLowerCase() !== config.expectedCommit ||
    readiness.body.region !== "fra1" ||
    readiness.body.luxart !== "reachable" ||
    readiness.body.schedule !== "ready" ||
    readiness.body.booking !== "ready" ||
    readiness.body.resourceMapSha256 !== config.expectedResourceMapSha256 ||
    readiness.body.capabilities?.reservationsEnabled !== true ||
    readiness.body.capabilities?.waitlistEnabled !== false ||
    readiness.body.capabilities?.businessRulesStatus !== "confirmed" ||
    (noPayments && (
      readiness.body.payments !== "disabled" ||
      readiness.body.capabilities?.topupsEnabled !== false ||
      readiness.body.capabilities?.topupMode !== "disabled"
    )) ||
    (!noPayments && (
      readiness.body.payments !== "ready" ||
      readiness.body.capabilities?.topupsEnabled !== true ||
      readiness.body.capabilities?.topupMode !== "stripe"
    ))
  ) {
    throw new Error("Target is not the exact approved ready live staging runtime.");
  }

  const login = await api<{ user: User }>(config, fetchImpl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      login: config.login,
      password: config.password,
      memberCardNumber: config.memberCardNumber,
    }),
  });
  if (login.body.user?.id !== config.expectedUserId) {
    throw new Error("Login returned a different user than ZONE4YOU_UAT_EXPECTED_USER_ID.");
  }
  const cookie = cookieFromSetCookie(login.setCookie);
  const beforeResult = await authenticatedSnapshot(config, fetchImpl, cookie);
  const requestIds: string[] = [readiness.requestId, login.requestId, beforeResult.requestId];
  const before = beforeResult.body;
  if (before.user?.id !== config.expectedUserId) throw new Error("Authenticated snapshot user does not match the approved test user.");
  const beforeActiveReservations = activeReservationIdentitySet(before);
  const lesson = before.lessons.find((candidate) => candidate.id === config.lessonId);
  if (!lesson) throw new Error("ZONE4YOU_UAT_LESSON_ID is not present in the current staging schedule.");
  if (
    !isBoundedKcAmount(before.user.creditBalanceKc) ||
    !isBoundedKcAmount(lesson.priceKc, 0) ||
    !isBoundedKcAmount(before.rules.minimumCreditForReservationKc, 0) ||
    !isBoundedKcAmount(before.rules.reservationHoldKc, 0) ||
    !isBoundedKcAmount(before.rules.lateCancelFeeKc, 0) ||
    !isBoundedKcAmount(before.rules.noShowFeeKc, 0)
  ) {
    throw new Error("The approved UAT snapshot contains invalid financial values; no mutation was attempted.");
  }
  if (exactActiveReservation(before, config.lessonId).length !== 0) {
    throw new Error("The approved UAT lesson already has an active reservation for this test user; no mutation was attempted.");
  }
  if (lesson.canCurrentUserReserve !== true) {
    throw new Error("The approved UAT lesson is not explicitly eligible for this test user; no mutation was attempted.");
  }
  if (!Number.isSafeInteger(lesson.luxartRoomNumber) || Number(lesson.luxartRoomNumber) <= 0) {
    throw new Error("The approved UAT lesson has no valid Luxart room number; no mutation was attempted.");
  }
  const availableCount = availablePlacesForLesson(lesson);
  if (
    !Number.isSafeInteger(lesson.capacity) ||
    lesson.capacity <= 0 ||
    !Number.isSafeInteger(lesson.occupiedCount) ||
    lesson.occupiedCount < 0 ||
    lesson.occupiedCount >= lesson.capacity ||
    !Number.isSafeInteger(availableCount) ||
    availableCount <= 0 ||
    availableCount > lesson.capacity ||
    lesson.occupiedCount + availableCount > lesson.capacity
  ) {
    throw new Error("The approved UAT lesson has no authoritative available place; no mutation was attempted.");
  }
  const startsAtMs = new Date(lesson.startsAt).getTime();
  const preflightNow = new Date();
  const hoursBeforeStart = (startsAtMs - preflightNow.getTime()) / 3_600_000;
  if (!Number.isFinite(hoursBeforeStart) || hoursBeforeStart < config.minimumHoursBeforeStart) {
    throw new Error("The approved UAT lesson is too close to its start time for the configured cancellation safety margin.");
  }
  if (
    !Number.isFinite(before.rules.reservationWindowHours) ||
    before.rules.reservationWindowHours <= 0 ||
    hoursBeforeStart > before.rules.reservationWindowHours
  ) {
    throw new Error("The approved UAT lesson is outside the confirmed reservation window; no mutation was attempted.");
  }
  if (!canCancelLessonAt(lesson, before.rules, preflightNow)) {
    throw new Error("The approved UAT lesson cannot be safely cancelled online; no mutation was attempted.");
  }
  const cancellationPolicy = cancellationPolicyForLesson(lesson, before.rules);
  const freeCancellationDeadline = new Date(freeCancellationDeadlineForLesson(lesson, before.rules)).getTime();
  const expectedPolicyFee = preflightNow.getTime() < freeCancellationDeadline
    ? 0
    : cancellationPolicy.lateCancelFeeKc;
  if (config.expectedCancellationFeeKc !== expectedPolicyFee) {
    throw new Error("The configured UAT cancellation fee does not match the confirmed lesson policy; no mutation was attempted.");
  }
  if (
    !Number.isFinite(before.user.creditBalanceKc) ||
    !Number.isFinite(before.rules.minimumCreditForReservationKc) ||
    before.user.creditBalanceKc < before.rules.minimumCreditForReservationKc
  ) {
    throw new Error("The approved UAT user does not have the confirmed minimum credit; no mutation was attempted.");
  }

  const createKey = `uat:create:${randomUUID()}`;
  let verifiedReservation: Reservation | undefined;
  let cancellationStateVerified = false;
  try {
    const created = await reservationRequest(config, fetchImpl, cookie, createKey);
    requestIds.push(created.requestId);
    assertUatReservation(created.body.reservation, config, "active");
    verifiedReservation = created.body.reservation;

    for (let replay = 0; replay < 3; replay += 1) {
      const repeated = await reservationRequest(config, fetchImpl, cookie, createKey);
      requestIds.push(repeated.requestId);
      assertUatReservation(repeated.body.reservation, config, "active", verifiedReservation.id);
    }

    const crossKeyResults = await Promise.all(
      [0, 1].map(async () => {
        try {
          return await reservationRequest(config, fetchImpl, cookie, `uat:create:parallel:${randomUUID()}`);
        } catch (error) {
          if (error instanceof UatApiError && error.code === "BOOKING_ALREADY_PROCESSING") return error;
          throw error;
        }
      }),
    );
    let parallelSuccesses = 0;
    for (const result of crossKeyResults) {
      requestIds.push(result.requestId);
      if (!(result instanceof UatApiError)) {
        parallelSuccesses += 1;
        assertUatReservation(result.body.reservation, config, "active", verifiedReservation.id);
      }
    }
    if (parallelSuccesses < 1) throw new Error("Neither parallel browser key returned the confirmed reservation result.");

    await waitForSnapshot(
      config,
      fetchImpl,
      cookie,
      requestIds,
      (snapshot) => exactActiveReservation(snapshot, config.lessonId).length === 1,
    );

    const cancelKey = `uat:cancel:${randomUUID()}`;
    const cancellation = await cancellationRequest(config, fetchImpl, cookie, verifiedReservation.id, cancelKey);
    requestIds.push(cancellation.requestId);
    assertUatReservation(cancellation.body.reservation, config, "cancelled", verifiedReservation.id);
    if (cancellation.body.reservation.cancellationFeeKc !== config.expectedCancellationFeeKc) {
      throw new Error("Cancellation fee does not match ZONE4YOU_UAT_EXPECTED_CANCELLATION_FEE_KC.");
    }
    for (let replay = 0; replay < 3; replay += 1) {
      const repeated = await cancellationRequest(config, fetchImpl, cookie, verifiedReservation.id, cancelKey);
      requestIds.push(repeated.requestId);
      assertUatReservation(repeated.body.reservation, config, "cancelled", verifiedReservation.id);
    }
    const crossKeyCancellation = await cancellationRequest(
      config,
      fetchImpl,
      cookie,
      verifiedReservation.id,
      `uat:cancel:other:${randomUUID()}`,
    );
    requestIds.push(crossKeyCancellation.requestId);
    assertUatReservation(crossKeyCancellation.body.reservation, config, "cancelled", verifiedReservation.id);

    const after = await waitForSnapshot(
      config,
      fetchImpl,
      cookie,
      requestIds,
      (snapshot) =>
        exactActiveReservation(snapshot, config.lessonId).length === 0 &&
        snapshot.user.creditBalanceKc === before.user.creditBalanceKc - config.expectedCancellationFeeKc,
    );
    cancellationStateVerified = true;
    if (JSON.stringify(activeReservationIdentitySet(after)) !== JSON.stringify(beforeActiveReservations)) {
      throw new Error("Final active reservation identity set does not match the pre-test state.");
    }

    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      target: config.target.origin,
      deploymentProvenanceVerified: true,
      commit: config.expectedCommit,
      phase: config.expectedPhase,
      region: "fra1",
      userVerified: true,
      personalizedEligibilityVerified: true,
      authoritativeAvailabilityVerified: true,
      reservationWindowVerified: true,
      onlineCancellationVerified: true,
      resourceMapSha256: config.expectedResourceMapSha256,
      lessonRoomNumber: lesson.luxartRoomNumber,
      lessonIdSha256: shortHash(config.lessonId),
      reservationIdSha256: shortHash(verifiedReservation.id),
      expectedCancellationFeeKc: config.expectedCancellationFeeKc,
      sameKeyCreateReplays: 3,
      parallelCreateRequests: 2,
      sameKeyCancellationReplays: 3,
      crossKeyCancellationReplay: true,
      oneActiveReservationObserved: true,
      cancellationStateVerified: true,
      snapshotRequestIdsRecorded: true,
      preExistingActiveReservationsPreserved: true,
      finalStateRestored: true,
      cancellationFeeMatched: true,
      requestIds,
    };
  } finally {
    if (verifiedReservation && !cancellationStateVerified) {
      try {
        const cleanup = await cancellationRequest(
          config,
          fetchImpl,
          cookie,
          verifiedReservation.id,
          `uat:cleanup:${randomUUID()}`,
        );
        assertUatReservation(cleanup.body.reservation, config, "cancelled", verifiedReservation.id);
        if (cleanup.body.reservation.cancellationFeeKc !== config.expectedCancellationFeeKc) {
          throw new Error("Cleanup cancellation fee did not match the approved UAT expectation.");
        }
      } catch {
        console.error(
          `UAT cleanup could not confirm cancellation. Stop booking mutations and reconcile reservationIdSha256=${shortHash(verifiedReservation.id)}.`,
        );
      }
    }
  }
}

async function main() {
  const config = loadBookingMutationUatConfig();
  console.log(JSON.stringify(await runBookingMutationUat(config), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const safeError = redactUatSecrets(error instanceof Error ? error.message : "Booking mutation UAT failed.");
    const rawCode = error instanceof UatApiError ? error.code : "UAT_FAILED";
    const safeCode = /^[A-Z0-9_]{1,80}$/.test(rawCode) ? rawCode : "UAT_FAILED";
    console.error(JSON.stringify({
      ok: false,
      checkedAt: new Date().toISOString(),
      code: safeCode,
      requestIdPresent: error instanceof UatApiError ? Boolean(error.requestId) : undefined,
      error: safeError,
    }, null, 2));
    process.exit(1);
  });
}
