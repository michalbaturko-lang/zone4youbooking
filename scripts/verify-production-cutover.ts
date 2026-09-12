import { createHash } from "node:crypto";
import type { AnyRecord } from "node:dns";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BookingCapabilities, Lesson } from "../src/lib/domain";
import { lessonPlacementEvidence } from "./lesson-placement-evidence";
import {
  addZone4YouCalendarDays,
  zone4YouDateKey,
  zone4YouScheduleRange,
  zone4YouTimeZone,
} from "../src/lib/zone4YouTime";
import {
  normalizeProductionDnsRecords,
  productionDnsRecordSetSha256,
  resolveProductionDnsRecords,
  type ProductionDnsRollbackRecord,
} from "./capture-production-domain-baseline";
import { readStableReleaseJson } from "./release-evidence-file";

type Environment = Record<string, string | undefined>;
type FetchLike = typeof fetch;
type ResolveAnyLike = (hostname: string) => Promise<AnyRecord[]>;

const productionOrigin = "https://booking.zone4you.cz";

export type ProductionPilotPhase = "booking_without_payments" | "booking_with_stripe";

export interface ApprovedLessonFeedEvidence {
  count: number;
  occurrenceSetSha256: string;
  roomPlacementSetSha256: string;
  resourceMapSha256: string;
  roomNumbers: number[];
  reformer: number;
  range: {
    from: string;
    to: string;
    days: 7;
    timeZone: typeof zone4YouTimeZone;
  };
  earliestStartsAt: string;
  latestStartsAt: string;
  dateKeys: string[];
}

export interface ProductionCutoverConfig {
  target: URL;
  expectedCommit: string;
  expectedPhase: ProductionPilotPhase;
  dossierSha256: string;
  cutoverApprovedAt: string;
  preCutoverCheckedAt: string;
  preCutoverEvidenceSha256: string;
  approvedLessonFeed: ApprovedLessonFeedEvidence;
  timeoutMs: number;
  maxDurationMs: number;
}

export interface ProductionCutoverDependencies {
  fetchImpl?: FetchLike;
  resolveAnyImpl?: ResolveAnyLike;
  now?: () => Date;
}

interface ApiResult<T> {
  body: T;
  requestId: string;
  status: number;
}

interface PreCutoverReceipt {
  ok?: unknown;
  checkedAt?: unknown;
  cutoverApprovedAt?: unknown;
  decision?: unknown;
  target?: unknown;
  commit?: unknown;
  launchMode?: unknown;
  dossierSha256?: unknown;
  lessonFeed?: unknown;
  explicitCutoverApproval?: unknown;
  dns?: {
    baselineFileSha256?: unknown;
    unchangedSinceCapture?: unknown;
    rollbackReady?: unknown;
  };
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

function approvedLessonFeed(value: unknown): ApprovedLessonFeedEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pre-cutover evidence is missing the approved lesson feed.");
  }
  const evidence = value as Record<string, unknown>;
  const count = evidence.count;
  const reformer = evidence.reformer;
  const occurrenceSetSha256 = evidence.occurrenceSetSha256;
  const roomPlacementSetSha256 = evidence.roomPlacementSetSha256;
  const resourceMapSha256 = evidence.resourceMapSha256;
  const roomNumbers = evidence.roomNumbers;
  const rangeValue = evidence.range;
  const earliestStartsAt = evidence.earliestStartsAt;
  const latestStartsAt = evidence.latestStartsAt;
  const dateKeys = evidence.dateKeys;
  if (
    !Number.isSafeInteger(count) || Number(count) < 1 ||
    !Number.isSafeInteger(reformer) || Number(reformer) < 1 || Number(reformer) > Number(count) ||
    typeof occurrenceSetSha256 !== "string" || !/^[a-f0-9]{64}$/.test(occurrenceSetSha256) ||
    typeof roomPlacementSetSha256 !== "string" || !/^[a-f0-9]{64}$/.test(roomPlacementSetSha256) ||
    typeof resourceMapSha256 !== "string" || !/^[a-f0-9]{64}$/.test(resourceMapSha256) ||
    !Array.isArray(roomNumbers) || roomNumbers.length === 0 ||
    !rangeValue || typeof rangeValue !== "object" || Array.isArray(rangeValue) ||
    typeof earliestStartsAt !== "string" || typeof latestStartsAt !== "string" ||
    !Array.isArray(dateKeys) || dateKeys.length === 0
  ) {
    throw new Error("Pre-cutover approved lesson feed is incomplete or invalid.");
  }
  const normalizedRoomNumbers = roomNumbers.map(Number);
  if (
    normalizedRoomNumbers.some((room) => !Number.isSafeInteger(room) || room < 1) ||
    JSON.stringify(normalizedRoomNumbers) !==
      JSON.stringify([...new Set(normalizedRoomNumbers)].sort((left, right) => left - right))
  ) {
    throw new Error("Pre-cutover approved lesson room numbers are incomplete or invalid.");
  }

  const range = rangeValue as Record<string, unknown>;
  const from = range.from;
  const to = range.to;
  if (
    typeof from !== "string" || typeof to !== "string" ||
    range.days !== 7 || range.timeZone !== zone4YouTimeZone
  ) {
    throw new Error("Pre-cutover approved lesson range is incomplete or invalid.");
  }
  const fromDay = /^(\d{4}-\d{2}-\d{2})T00:00:00\.000Z$/.exec(from)?.[1];
  const toDay = /^(\d{4}-\d{2}-\d{2})T00:00:00\.000Z$/.exec(to)?.[1];
  if (!fromDay || !toDay || addZone4YouCalendarDays(fromDay, 7) !== toDay) {
    throw new Error("Pre-cutover approved lesson range must contain exactly seven Prague calendar days.");
  }

  const earliest = new Date(earliestStartsAt);
  const latest = new Date(latestStartsAt);
  const normalizedDateKeys = dateKeys.map((value) => typeof value === "string" ? value : "");
  const expectedDateKeys = [...new Set(normalizedDateKeys)].sort();
  if (
    Number.isNaN(earliest.getTime()) || Number.isNaN(latest.getTime()) || latest < earliest ||
    JSON.stringify(normalizedDateKeys) !== JSON.stringify(expectedDateKeys) ||
    normalizedDateKeys.some((day) => !/^\d{4}-\d{2}-\d{2}$/.test(day) || day < fromDay || day >= toDay) ||
    zone4YouDateKey(earliest) !== normalizedDateKeys[0] ||
    zone4YouDateKey(latest) !== normalizedDateKeys.at(-1)
  ) {
    throw new Error("Pre-cutover approved lesson bounds are incomplete or invalid.");
  }

  return {
    count: Number(count),
    occurrenceSetSha256,
    roomPlacementSetSha256,
    resourceMapSha256,
    roomNumbers: normalizedRoomNumbers,
    reformer: Number(reformer),
    range: { from, to, days: 7, timeZone: zone4YouTimeZone },
    earliestStartsAt: earliest.toISOString(),
    latestStartsAt: latest.toISOString(),
    dateKeys: normalizedDateKeys,
  };
}

export function loadProductionCutoverConfig(
  environment: Environment = process.env,
  now = new Date(),
): ProductionCutoverConfig {
  const target = new URL(required(environment, "ZONE4YOU_PRODUCTION_APP_URL"));
  if (
    target.origin !== productionOrigin ||
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash
  ) {
    throw new Error(`ZONE4YOU_PRODUCTION_APP_URL must exactly equal ${productionOrigin}/.`);
  }

  const expectedCommit = required(environment, "ZONE4YOU_PRODUCTION_EXPECTED_COMMIT");
  if (!/^[a-f0-9]{40}$/.test(expectedCommit)) {
    throw new Error("ZONE4YOU_PRODUCTION_EXPECTED_COMMIT must be a full lowercase 40-character Git SHA.");
  }

  const expectedPhase = required(environment, "ZONE4YOU_PRODUCTION_EXPECTED_PHASE");
  if (!(["booking_without_payments", "booking_with_stripe"] as string[]).includes(expectedPhase)) {
    throw new Error(
      "ZONE4YOU_PRODUCTION_EXPECTED_PHASE must be booking_without_payments or booking_with_stripe.",
    );
  }

  const maxAgeMinutes = boundedInteger(
    environment,
    "ZONE4YOU_PRECUTOVER_MAX_AGE_MINUTES",
    30,
    1,
    120,
  );
  if (Number.isNaN(now.getTime())) throw new Error("Production cutover configuration time is invalid.");

  const evidencePath = resolve(required(environment, "ZONE4YOU_PRECUTOVER_EVIDENCE_PATH"));
  const loadedReceipt = readStableReleaseJson(evidencePath, "Pre-cutover evidence", {
    maximumBytes: 256 * 1024,
    ownerOnly: true,
  });
  const preCutoverEvidenceSha256 = loadedReceipt.sha256;
  const parsedReceipt = loadedReceipt.data;
  if (!parsedReceipt || typeof parsedReceipt !== "object" || Array.isArray(parsedReceipt)) {
    throw new Error("Pre-cutover evidence is not a JSON object.");
  }
  const receipt = parsedReceipt as PreCutoverReceipt;

  const dossierSha256 = receipt.dossierSha256;
  if (
    receipt.ok !== true ||
    receipt.decision !== "GO_TO_AUTHORIZED_DNS_CHANGE" ||
    receipt.target !== productionOrigin ||
    receipt.commit !== expectedCommit ||
    receipt.launchMode !== expectedPhase ||
    typeof dossierSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(dossierSha256) ||
    receipt.explicitCutoverApproval !== true ||
    !receipt.dns ||
    receipt.dns.unchangedSinceCapture !== true ||
    receipt.dns.rollbackReady !== true ||
    typeof receipt.dns.baselineFileSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(receipt.dns.baselineFileSha256)
  ) {
    throw new Error("Pre-cutover evidence does not match the approved production release.");
  }
  const approvedFeed = approvedLessonFeed(receipt.lessonFeed);

  if (typeof receipt.checkedAt !== "string" || typeof receipt.cutoverApprovedAt !== "string") {
    throw new Error("Pre-cutover evidence chronology is missing or invalid.");
  }
  const preCutoverCheckedAt = new Date(receipt.checkedAt);
  const cutoverApprovedAt = new Date(receipt.cutoverApprovedAt);
  if (Number.isNaN(preCutoverCheckedAt.getTime()) || Number.isNaN(cutoverApprovedAt.getTime())) {
    throw new Error("Pre-cutover evidence chronology is missing or invalid.");
  }
  if (cutoverApprovedAt.getTime() > preCutoverCheckedAt.getTime()) {
    throw new Error("Pre-cutover evidence predates the final cutover approval.");
  }
  const ageMs = now.getTime() - preCutoverCheckedAt.getTime();
  if (ageMs < 0) {
    throw new Error("Production verification must not predate the pre-cutover evidence.");
  }
  if (ageMs > maxAgeMinutes * 60_000) {
    throw new Error("Pre-cutover evidence is stale and must be regenerated.");
  }

  const dossierConfirmation = `VERIFY_ZONE4YOU_RELEASE_DOSSIER:${dossierSha256}`;
  if (environment.ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION !== dossierConfirmation) {
    throw new Error(
      `ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION must exactly equal ${dossierConfirmation}.`,
    );
  }

  const expectedConfirmation = `VERIFY_ZONE4YOU_PRODUCTION_CUTOVER:${preCutoverEvidenceSha256}`;
  if (environment.ZONE4YOU_PRODUCTION_CUTOVER_CONFIRMATION !== expectedConfirmation) {
    throw new Error(
      `ZONE4YOU_PRODUCTION_CUTOVER_CONFIRMATION must exactly equal ${expectedConfirmation}.`,
    );
  }

  const timeoutMs = boundedInteger(
    environment,
    "ZONE4YOU_PRODUCTION_TIMEOUT_MS",
    12_000,
    1_000,
    30_000,
  );
  const maxDurationSeconds = boundedInteger(
    environment,
    "ZONE4YOU_PRODUCTION_MAX_SECONDS",
    60,
    10,
    300,
  );

  return {
    target,
    expectedCommit,
    expectedPhase: expectedPhase as ProductionPilotPhase,
    dossierSha256,
    cutoverApprovedAt: cutoverApprovedAt.toISOString(),
    preCutoverCheckedAt: preCutoverCheckedAt.toISOString(),
    preCutoverEvidenceSha256,
    approvedLessonFeed: approvedFeed,
    timeoutMs,
    maxDurationMs: maxDurationSeconds * 1_000,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function api<T>(
  config: ProductionCutoverConfig,
  fetchImpl: FetchLike,
  path: string,
  locale?: "cs" | "en",
): Promise<ApiResult<T>> {
  const response = await fetchImpl(new URL(path, config.target), {
    redirect: "error",
    signal: AbortSignal.timeout(config.timeoutMs),
    headers: {
      Accept: "application/json",
      ...(locale ? { "X-Zone4You-Locale": locale } : {}),
    },
  });
  const requestId = response.headers.get("x-request-id");
  if (!requestId) throw new Error(`GET ${path} did not return X-Request-ID.`);
  const cacheControl = response.headers.get("cache-control");
  if (!cacheControl?.toLowerCase().includes("no-store")) {
    throw new Error(`GET ${path} did not return Cache-Control: no-store.`);
  }
  const body = (await response.json().catch(() => ({}))) as T;
  return { body, requestId, status: response.status };
}

function requiredHeader(response: Response, name: string, expected: string) {
  const value = response.headers.get(name);
  if (!value?.toLowerCase().includes(expected.toLowerCase())) {
    throw new Error(`${name} is missing or invalid on the production homepage.`);
  }
}

function assertReadiness(
  config: ProductionCutoverConfig,
  result: ApiResult<{
    status?: string;
    mode?: string;
    phase?: string;
    commit?: string;
    region?: string;
    luxart?: string;
    schedule?: string;
    bookingNotifications?: string;
    resourceMapSha256?: string;
    rateLimit?: string;
    booking?: string;
    payments?: string;
    capabilities?: Partial<BookingCapabilities>;
  }>,
) {
  const capabilities = result.body.capabilities;
  const paymentReady = config.expectedPhase === "booking_with_stripe";
  if (
    result.status !== 200 ||
    result.body.status !== "ready" ||
    result.body.mode !== "live" ||
    result.body.phase !== config.expectedPhase ||
    result.body.commit !== config.expectedCommit ||
    result.body.region !== "fra1" ||
    result.body.luxart !== "reachable" ||
    result.body.schedule !== "ready" ||
    result.body.bookingNotifications !== "ready" ||
    result.body.resourceMapSha256 !== config.approvedLessonFeed.resourceMapSha256 ||
    result.body.rateLimit !== "postgres" ||
    result.body.booking !== "ready" ||
    result.body.payments !== (paymentReady ? "ready" : "disabled") ||
    capabilities?.reservationsEnabled !== true ||
    capabilities.waitlistEnabled !== false ||
    capabilities.businessRulesStatus !== "confirmed" ||
    capabilities.favoritesSync !== "device" ||
    capabilities.forgotPasswordEnabled !== false ||
    capabilities.englishEnabled !== true ||
    capabilities.topupsEnabled !== paymentReady ||
    capabilities.topupMode !== (paymentReady ? "stripe" : "disabled")
  ) {
    throw new Error(
      "Production readiness does not match the approved commit, phase, fra1 region, Luxart, resource mapping, booking notifications, PostgreSQL or pilot capabilities.",
    );
  }
}

function lessonFeedEvidence(
  lessons: Lesson[] | undefined,
  language: "Czech" | "English",
  range: { from: string; to: string },
) {
  if (!Array.isArray(lessons) || lessons.length === 0) {
    throw new Error(`${language} production lesson feed is empty or invalid.`);
  }

  const ids = new Set<string>();
  const rooms = new Set<string>();
  const startsAt: string[] = [];
  const dateKeys = new Set<string>();
  let reformer = 0;
  const placement = lessonPlacementEvidence(lessons, `${language} production lesson feed`);
  const fromDay = range.from.slice(0, 10);
  const toDay = range.to.slice(0, 10);

  for (const lesson of lessons) {
    if (
      !lesson ||
      !lesson.id ||
      !lesson.name ||
      !lesson.roomName ||
      !lesson.startsAt ||
      !lesson.endsAt ||
      !lesson.instructorName ||
      !lesson.category
    ) {
      throw new Error(`${language} production lesson feed contains an item without a required display field.`);
    }
    if (ids.has(lesson.id)) {
      throw new Error(`${language} production lesson feed contains a duplicate occurrence ID.`);
    }

    const start = new Date(lesson.startsAt);
    const end = new Date(lesson.endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new Error(`${language} production lesson feed contains invalid lesson times.`);
    }
    const normalizedStart = start.toISOString();
    const dayKey = zone4YouDateKey(normalizedStart);
    if (dayKey < fromDay || dayKey >= toDay) {
      throw new Error(
        `${language} production lesson feed contains an occurrence outside the seven-day Prague range: ${dayKey}.`,
      );
    }

    ids.add(lesson.id);
    rooms.add(lesson.roomName);
    startsAt.push(normalizedStart);
    dateKeys.add(dayKey);
    if (/reformer/i.test(`${lesson.name} ${lesson.roomName} ${lesson.category}`)) reformer += 1;
  }

  if (reformer === 0) throw new Error(`${language} production lesson feed contains no Reformer lesson.`);
  startsAt.sort();
  return {
    count: lessons.length,
    occurrenceSetSha256: createHash("sha256")
      .update([...ids].sort().join("\n"), "utf8")
      .digest("hex"),
    roomPlacementSetSha256: placement.roomPlacementSetSha256,
    roomNumbers: placement.roomNumbers,
    rooms: [...rooms].sort(),
    reformer,
    earliestStartsAt: startsAt[0],
    latestStartsAt: startsAt.at(-1),
    dateKeys: [...dateKeys].sort(),
  };
}

function sameOccurrences(
  czech: ReturnType<typeof lessonFeedEvidence>,
  english: ReturnType<typeof lessonFeedEvidence>,
) {
  return (
    czech.count === english.count &&
    czech.occurrenceSetSha256 === english.occurrenceSetSha256 &&
    czech.roomPlacementSetSha256 === english.roomPlacementSetSha256 &&
    JSON.stringify(czech.roomNumbers) === JSON.stringify(english.roomNumbers) &&
    czech.earliestStartsAt === english.earliestStartsAt &&
    czech.latestStartsAt === english.latestStartsAt &&
    JSON.stringify(czech.dateKeys) === JSON.stringify(english.dateKeys)
  );
}

function matchesApprovedLessonFeed(
  observed: ReturnType<typeof lessonFeedEvidence>,
  approved: ApprovedLessonFeedEvidence,
) {
  return (
    observed.count === approved.count &&
    observed.occurrenceSetSha256 === approved.occurrenceSetSha256 &&
    observed.roomPlacementSetSha256 === approved.roomPlacementSetSha256 &&
    JSON.stringify(observed.roomNumbers) === JSON.stringify(approved.roomNumbers) &&
    observed.reformer === approved.reformer &&
    observed.earliestStartsAt === approved.earliestStartsAt &&
    observed.latestStartsAt === approved.latestStartsAt &&
    JSON.stringify(observed.dateKeys) === JSON.stringify(approved.dateKeys)
  );
}

export async function runProductionCutoverVerification(
  config: ProductionCutoverConfig,
  dependencies: ProductionCutoverDependencies = {},
) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const resolveAnyImpl = dependencies.resolveAnyImpl ?? resolveProductionDnsRecords;
  const now = dependencies.now ?? (() => new Date());
  const startedAt = Date.now();
  const checkedAt = now();
  if (Number.isNaN(checkedAt.getTime())) throw new Error("Production verification time is invalid.");
  const approvedFeed = approvedLessonFeed(config.approvedLessonFeed);
  const cutoverApprovedAt = new Date(config.cutoverApprovedAt);
  const preCutoverCheckedAt = new Date(config.preCutoverCheckedAt);
  if (
    Number.isNaN(cutoverApprovedAt.getTime()) ||
    Number.isNaN(preCutoverCheckedAt.getTime()) ||
    cutoverApprovedAt.getTime() > preCutoverCheckedAt.getTime() ||
    preCutoverCheckedAt.getTime() > checkedAt.getTime()
  ) {
    throw new Error("Production verification chronology is invalid.");
  }
  const range = zone4YouScheduleRange(checkedAt, 7);
  if (
    range.from !== approvedFeed.range.from ||
    range.to !== approvedFeed.range.to
  ) {
    throw new Error(
      "Production verification no longer covers the approved lesson range; regenerate the live release evidence.",
    );
  }

  let unresolvedDnsRecords: AnyRecord[];
  try {
    unresolvedDnsRecords = await resolveAnyImpl(config.target.hostname);
  } catch {
    throw new Error("Production hostname DNS could not be resolved.");
  }
  const dnsRecords: ProductionDnsRollbackRecord[] = normalizeProductionDnsRecords(unresolvedDnsRecords);
  const dnsTypes = [...new Set(
    dnsRecords
      .map((record) => typeof record.type === "string" ? record.type.toUpperCase() : "")
      .filter(Boolean),
  )].sort();
  if (dnsRecords.length === 0 || !dnsTypes.some((type) => ["A", "AAAA", "CNAME"].includes(type))) {
    throw new Error("Production hostname has no A, AAAA or CNAME DNS answer.");
  }
  const dnsFingerprintSha256 = productionDnsRecordSetSha256(dnsRecords);

  const home = await fetchImpl(config.target, {
    redirect: "error",
    signal: AbortSignal.timeout(config.timeoutMs),
    headers: { Accept: "text/html" },
  });
  if (home.status !== 200) throw new Error(`Production homepage returned HTTP ${home.status}.`);
  requiredHeader(home, "content-security-policy", "frame-ancestors 'none'");
  requiredHeader(home, "strict-transport-security", "includeSubDomains");
  requiredHeader(home, "x-content-type-options", "nosniff");

  const health = await api<{ status?: string }>(config, fetchImpl, "/api/health");
  if (health.status !== 200 || health.body.status !== "ok") {
    throw new Error("Production health endpoint is not healthy.");
  }

  const readiness = await api<{
    status?: string;
    mode?: string;
    phase?: string;
    commit?: string;
    region?: string;
    luxart?: string;
    schedule?: string;
    bookingNotifications?: string;
    resourceMapSha256?: string;
    rateLimit?: string;
    booking?: string;
    payments?: string;
    capabilities?: Partial<BookingCapabilities>;
  }>(config, fetchImpl, "/api/readiness");
  assertReadiness(config, readiness);

  const [czechResult, englishResult] = await Promise.all([
    api<{ lessons?: Lesson[] }>(config, fetchImpl, "/api/lessons", "cs"),
    api<{ lessons?: Lesson[] }>(config, fetchImpl, "/api/lessons", "en"),
  ]);
  if (czechResult.status !== 200 || englishResult.status !== 200) {
    throw new Error("Production lesson feed did not return HTTP 200 in both languages.");
  }
  const czech = lessonFeedEvidence(czechResult.body.lessons, "Czech", range);
  const english = lessonFeedEvidence(englishResult.body.lessons, "English", range);
  if (!sameOccurrences(czech, english)) {
    throw new Error("Czech and English production feeds do not contain the same lesson occurrences and range.");
  }
  if (
    !matchesApprovedLessonFeed(czech, approvedFeed) ||
    !matchesApprovedLessonFeed(english, approvedFeed)
  ) {
    throw new Error(
      "Production lesson feed does not exactly match the approved live Luxart and staging lesson evidence.",
    );
  }
  const durationMs = Date.now() - startedAt;
  if (durationMs > config.maxDurationMs) {
    throw new Error(
      `Production cutover verification took ${durationMs} ms, above the ${config.maxDurationMs} ms limit.`,
    );
  }

  return {
    ok: true,
    checkedAt: checkedAt.toISOString(),
    target: config.target.origin,
    expectedCommit: config.expectedCommit,
    expectedPhase: config.expectedPhase,
    dossierSha256: config.dossierSha256,
    cutoverApprovedAt: config.cutoverApprovedAt,
    preCutoverCheckedAt: config.preCutoverCheckedAt,
    preCutoverEvidenceSha256: config.preCutoverEvidenceSha256,
    durationMs,
    maximumDurationMs: config.maxDurationMs,
    dns: {
      recordCount: dnsRecords.length,
      recordTypes: dnsTypes,
      fingerprintSha256: dnsFingerprintSha256,
    },
    browserSecurity: true,
    requestIds: {
      health: health.requestId,
      readiness: readiness.requestId,
      lessonsCs: czechResult.requestId,
      lessonsEn: englishResult.requestId,
    },
    readiness: {
      status: readiness.body.status,
      mode: readiness.body.mode,
      phase: readiness.body.phase,
      commit: readiness.body.commit,
      region: readiness.body.region,
      luxart: readiness.body.luxart,
      schedule: readiness.body.schedule,
      bookingNotifications: readiness.body.bookingNotifications,
      resourceMapSha256: readiness.body.resourceMapSha256,
      rateLimit: readiness.body.rateLimit,
      booking: readiness.body.booking,
      payments: readiness.body.payments,
      capabilities: readiness.body.capabilities,
    },
    lessons: {
      range: { ...range, days: 7, timeZone: zone4YouTimeZone },
      approved: approvedFeed,
      count: czech.count,
      occurrenceSetSha256: czech.occurrenceSetSha256,
      roomPlacementSetSha256: czech.roomPlacementSetSha256,
      roomNumbers: czech.roomNumbers,
      rooms: czech.rooms,
      reformer: czech.reformer,
      czech,
      english,
    },
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runProductionCutoverVerification(loadProductionCutoverConfig())
    .then((evidence) => console.log(JSON.stringify(evidence, null, 2)))
    .catch((error: unknown) => {
      console.error(
        `Production cutover verification failed: ${error instanceof Error ? error.message : "Unknown error."}`,
      );
      process.exitCode = 1;
    });
}
