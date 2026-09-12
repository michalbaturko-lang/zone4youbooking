import { pathToFileURL } from "node:url";
import type { BookingCapabilities } from "../src/lib/domain";
import { approvedRuntimeRegion } from "../src/lib/deploymentPreflight";

type Environment = Record<string, string | undefined>;
type FetchLike = typeof fetch;

export interface ReadonlyRollbackConfig {
  target: URL;
  expectedCommit: string;
  rollbackStartedAt: Date;
  timeoutMs: number;
  maxDurationMs: number;
}

interface ApiResult<T> {
  body: T;
  requestId: string;
  status: number;
}

function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function boundedInteger(
  environment: Environment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = Number(environment[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function timestamp(rawValue: string, name: string) {
  const value = new Date(rawValue);
  if (!Number.isFinite(value.getTime())) throw new Error(`${name} must be a valid timestamp.`);
  return value;
}

function assertWithinRecoveryWindow(startedAt: Date, now: Date, maximumDurationMs: number) {
  const elapsedMs = now.getTime() - startedAt.getTime();
  if (elapsedMs < 0) throw new Error("ZONE4YOU_ROLLBACK_STARTED_AT must not be in the future.");
  if (elapsedMs > maximumDurationMs) {
    throw new Error("The five-minute rollback recovery objective was already exceeded.");
  }
  return elapsedMs;
}

export function loadReadonlyRollbackConfig(
  environment: Environment = process.env,
  now = new Date(),
): ReadonlyRollbackConfig {
  const target = new URL(required(environment, "ZONE4YOU_ROLLBACK_APP_URL"));
  if (target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
    throw new Error("ZONE4YOU_ROLLBACK_APP_URL must be a clean origin ending in / without credentials, query or hash.");
  }

  const local = ["localhost", "127.0.0.1", "::1"].includes(target.hostname);
  if (target.protocol !== "https:" && !(local && environment.ZONE4YOU_ROLLBACK_ALLOW_LOCAL_HTTP === "true")) {
    throw new Error("Rollback verification requires HTTPS; local HTTP needs ZONE4YOU_ROLLBACK_ALLOW_LOCAL_HTTP=true.");
  }

  const expectedConfirmation = `READ_ONLY_ROLLBACK:${target.origin}`;
  if (environment.ZONE4YOU_ROLLBACK_CONFIRMATION !== expectedConfirmation) {
    throw new Error(`ZONE4YOU_ROLLBACK_CONFIRMATION must exactly equal ${expectedConfirmation}.`);
  }

  const timeoutMs = boundedInteger(environment, "ZONE4YOU_ROLLBACK_TIMEOUT_MS", 12_000, 1_000, 30_000);
  const maxDurationSeconds = boundedInteger(environment, "ZONE4YOU_ROLLBACK_MAX_SECONDS", 300, 10, 300);
  const maxDurationMs = maxDurationSeconds * 1_000;
  const expectedCommit = required(environment, "ZONE4YOU_ROLLBACK_EXPECTED_COMMIT").toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(expectedCommit)) {
    throw new Error("ZONE4YOU_ROLLBACK_EXPECTED_COMMIT must be a full 40-character Git SHA.");
  }
  const rollbackStartedAt = timestamp(
    required(environment, "ZONE4YOU_ROLLBACK_STARTED_AT"),
    "ZONE4YOU_ROLLBACK_STARTED_AT",
  );
  assertWithinRecoveryWindow(rollbackStartedAt, now, maxDurationMs);
  return { target, expectedCommit, rollbackStartedAt, timeoutMs, maxDurationMs };
}

async function api<T>(
  config: ReadonlyRollbackConfig,
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
  const body = (await response.json().catch(() => ({}))) as T;
  return { body, requestId, status: response.status };
}

function assertOk(result: ApiResult<{ status?: string }>, path: string, expectedStatus: string) {
  if (result.status !== 200 || result.body.status !== expectedStatus) {
    throw new Error(`${path} did not return the expected ${expectedStatus} state.`);
  }
}

function assertBlocked(
  result: ApiResult<{ code?: string }>,
  operation: string,
  expectedCode: "BOOKING_READ_ONLY" | "PAYMENTS_DISABLED",
) {
  if (result.status !== 503 || result.body.code !== expectedCode) {
    throw new Error(`${operation} was not blocked by ${expectedCode}; stop the rollback drill.`);
  }
}

export async function runReadonlyRollbackDrill(
  config: ReadonlyRollbackConfig,
  fetchImpl: FetchLike = fetch,
  clock: () => Date = () => new Date(),
) {
  const verificationStartedAt = clock();
  assertWithinRecoveryWindow(config.rollbackStartedAt, verificationStartedAt, config.maxDurationMs);
  const requestIds: string[] = [];

  const health = await api<{ status?: string }>(config, fetchImpl, "/api/health");
  requestIds.push(health.requestId);
  assertOk(health, "/api/health", "ok");

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
    capabilities?: Partial<BookingCapabilities>;
  }>(config, fetchImpl, "/api/readiness");
  requestIds.push(readiness.requestId);
  const capabilities = readiness.body.capabilities;
  if (
    readiness.status !== 200 ||
    readiness.body.status !== "ready" ||
    readiness.body.mode !== "live" ||
    readiness.body.phase !== "read_only" ||
    readiness.body.commit?.toLowerCase() !== config.expectedCommit ||
    readiness.body.region !== approvedRuntimeRegion ||
    readiness.body.luxart !== "reachable" ||
    readiness.body.schedule !== "ready" ||
    readiness.body.booking !== "read_only" ||
    readiness.body.payments !== "disabled" ||
    capabilities?.reservationsEnabled !== false ||
    capabilities.waitlistEnabled !== false ||
    capabilities.topupsEnabled !== false ||
    capabilities.topupMode !== "disabled"
  ) {
    throw new Error(
      "Target is not the expected healthy live read-only commit in fra1 with schedule available and all mutations disabled.",
    );
  }

  const snapshot = await api<{ lessons?: unknown[] }>(config, fetchImpl, "/api/booking/snapshot");
  requestIds.push(snapshot.requestId);
  if (snapshot.status !== 200 || !Array.isArray(snapshot.body.lessons) || snapshot.body.lessons.length === 0) {
    throw new Error("Read-only schedule snapshot is unavailable or empty.");
  }

  const reservation = await api<{ code?: string }>(config, fetchImpl, "/api/reservations", {
    method: "POST",
    headers: { "Idempotency-Key": "rollback-drill-create-noop" },
    body: JSON.stringify({ lessonId: "rollback-drill-noop" }),
  });
  requestIds.push(reservation.requestId);
  assertBlocked(reservation, "Reservation creation", "BOOKING_READ_ONLY");

  const cancellation = await api<{ code?: string }>(config, fetchImpl, "/api/reservations/rollback-drill-noop", {
    method: "DELETE",
    headers: { "Idempotency-Key": "rollback-drill-cancel-noop" },
    body: "{}",
  });
  requestIds.push(cancellation.requestId);
  assertBlocked(cancellation, "Reservation cancellation", "BOOKING_READ_ONLY");

  const waitlist = await api<{ code?: string }>(config, fetchImpl, "/api/waitlist", {
    method: "POST",
    body: JSON.stringify({ lessonId: "rollback-drill-noop" }),
  });
  requestIds.push(waitlist.requestId);
  assertBlocked(waitlist, "Waitlist creation", "BOOKING_READ_ONLY");

  const checkout = await api<{ code?: string }>(config, fetchImpl, "/api/payments/checkout", {
    method: "POST",
    body: JSON.stringify({ amountKc: 500 }),
  });
  requestIds.push(checkout.requestId);
  assertBlocked(checkout, "Stripe Checkout", "PAYMENTS_DISABLED");

  const readOnlyVerifiedAt = clock();
  const verificationDurationMs = readOnlyVerifiedAt.getTime() - verificationStartedAt.getTime();
  if (verificationDurationMs < 0) throw new Error("Rollback verification clock moved backwards.");
  const recoveryDurationMs = assertWithinRecoveryWindow(
    config.rollbackStartedAt,
    readOnlyVerifiedAt,
    config.maxDurationMs,
  );

  return {
    schemaVersion: 2,
    ok: true,
    checkedAt: readOnlyVerifiedAt.toISOString(),
    rollbackStartedAt: config.rollbackStartedAt.toISOString(),
    readOnlyVerifiedAt: readOnlyVerifiedAt.toISOString(),
    target: config.target.origin,
    commit: config.expectedCommit,
    phase: "read_only",
    region: approvedRuntimeRegion,
    recoveryDurationMs,
    verificationDurationMs,
    maximumDurationMs: config.maxDurationMs,
    lessonCount: snapshot.body.lessons.length,
    healthReady: true,
    luxartReadable: true,
    bookingReadOnly: true,
    waitlistReadOnly: true,
    paymentsDisabled: true,
    requestIds,
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runReadonlyRollbackDrill(loadReadonlyRollbackConfig())
    .then((evidence) => console.log(JSON.stringify(evidence, null, 2)))
    .catch((error: unknown) => {
      console.error(`Rollback verification failed: ${error instanceof Error ? error.message : "Unknown error."}`);
      process.exitCode = 1;
    });
}
