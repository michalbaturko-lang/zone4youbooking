import { createHash } from "node:crypto";
import type { AnyRecord } from "node:dns";
import { resolveAny } from "node:dns/promises";
import { pathToFileURL } from "node:url";
import type { BookingCapabilities, Lesson } from "../src/lib/domain";
import { zone4YouDateKey, zone4YouScheduleRange, zone4YouTimeZone } from "../src/lib/zone4YouTime";

type Environment = Record<string, string | undefined>;
type FetchLike = typeof fetch;
type DnsRecord = AnyRecord;
type ResolveAnyLike = (hostname: string) => Promise<DnsRecord[]>;

const productionOrigin = "https://booking.zone4you.cz";

export type ProductionPilotPhase = "booking_without_payments" | "booking_with_stripe";

export interface ProductionCutoverConfig {
  target: URL;
  expectedCommit: string;
  expectedPhase: ProductionPilotPhase;
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

export function loadProductionCutoverConfig(
  environment: Environment = process.env,
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

  const expectedConfirmation = `VERIFY_ZONE4YOU_PRODUCTION_CUTOVER:${expectedCommit}`;
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
      "Production readiness does not match the approved commit, phase, fra1 region, Luxart, PostgreSQL or pilot capabilities.",
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
    czech.earliestStartsAt === english.earliestStartsAt &&
    czech.latestStartsAt === english.latestStartsAt &&
    JSON.stringify(czech.dateKeys) === JSON.stringify(english.dateKeys)
  );
}

export async function runProductionCutoverVerification(
  config: ProductionCutoverConfig,
  dependencies: ProductionCutoverDependencies = {},
) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const resolveAnyImpl = dependencies.resolveAnyImpl ?? resolveAny;
  const now = dependencies.now ?? (() => new Date());
  const startedAt = Date.now();
  const checkedAt = now();
  if (Number.isNaN(checkedAt.getTime())) throw new Error("Production verification time is invalid.");
  const range = zone4YouScheduleRange(checkedAt, 7);

  let dnsRecords: DnsRecord[];
  try {
    dnsRecords = await resolveAnyImpl(config.target.hostname);
  } catch {
    throw new Error("Production hostname DNS could not be resolved.");
  }
  const dnsTypes = [...new Set(
    dnsRecords
      .map((record) => typeof record.type === "string" ? record.type.toUpperCase() : "")
      .filter(Boolean),
  )].sort();
  if (dnsRecords.length === 0 || !dnsTypes.some((type) => ["A", "AAAA", "CNAME"].includes(type))) {
    throw new Error("Production hostname has no A, AAAA or CNAME DNS answer.");
  }
  const dnsFingerprintSha256 = createHash("sha256")
    .update(dnsRecords.map(stableJson).sort().join("\n"), "utf8")
    .digest("hex");

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
      rateLimit: readiness.body.rateLimit,
      booking: readiness.body.booking,
      payments: readiness.body.payments,
      capabilities: readiness.body.capabilities,
    },
    lessons: {
      range: { ...range, days: 7, timeZone: zone4YouTimeZone },
      count: czech.count,
      occurrenceSetSha256: czech.occurrenceSetSha256,
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
