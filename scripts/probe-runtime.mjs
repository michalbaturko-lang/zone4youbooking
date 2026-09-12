import { createHash } from "node:crypto";

const baseUrl = process.env.APP_BASE_URL;
const requireReformer = process.env.PROBE_REQUIRE_REFORMER !== "false";
const scheduleDays = 7;
const scheduleTimeZone = "Europe/Prague";

if (!baseUrl) {
  console.error("APP_BASE_URL is required.");
  process.exit(1);
}

const target = new URL(baseUrl);
const local = ["localhost", "127.0.0.1", "::1"].includes(target.hostname);
if (target.protocol !== "https:" && !local) {
  console.error("Runtime probe refuses a non-HTTPS public target.");
  process.exit(1);
}

const evidenceCheckedAt = new Date();
const pragueDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: scheduleTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function pragueDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Lesson contains an invalid start time.");
  const parts = Object.fromEntries(
    pragueDateFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addCalendarDays(dayKey, offset) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset, 12)).toISOString().slice(0, 10);
}

const scheduleFromDay = pragueDateKey(evidenceCheckedAt);
const scheduleRange = {
  from: `${scheduleFromDay}T00:00:00.000Z`,
  to: `${addCalendarDays(scheduleFromDay, scheduleDays)}T00:00:00.000Z`,
  days: scheduleDays,
  timeZone: scheduleTimeZone,
};

const evidence = {
  checkedAt: evidenceCheckedAt.toISOString(),
  target: target.origin,
  checks: {},
};

async function timedFetch(path, init) {
  const startedAt = performance.now();
  const response = await fetch(new URL(path, target), {
    ...init,
    signal: AbortSignal.timeout(Number(process.env.PROBE_TIMEOUT_MS ?? "10000")),
    headers: { Accept: "application/json", ...init?.headers },
  });
  return { response, durationMs: Math.round(performance.now() - startedAt) };
}

function requireHeader(response, name, includes) {
  const value = response.headers.get(name);
  if (!value || (includes && !value.toLowerCase().includes(includes.toLowerCase()))) {
    throw new Error(`${name} is missing or invalid.`);
  }
  return value;
}

async function jsonEndpoint(path, expectedStatus = 200, init) {
  const { response, durationMs } = await timedFetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (response.status !== expectedStatus) {
    throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  requireHeader(response, "x-request-id");
  requireHeader(response, "cache-control", "no-store");
  return { body, durationMs };
}

function lessonFeedEvidence(result, language, requireLuxartRoomNumbers) {
  const lessons = result.body.lessons;
  if (!Array.isArray(lessons) || lessons.length === 0) {
    throw new Error(`${language} lesson feed is empty or invalid.`);
  }
  const ids = new Set();
  const rooms = new Set();
  const startsAt = [];
  const dateKeys = new Set();
  const roomNumbers = new Set();
  const roomPlacements = [];
  let reformer = 0;
  for (const lesson of lessons) {
    if (!lesson?.id || !lesson?.name || !lesson?.roomName || !lesson?.startsAt) {
      throw new Error(`${language} lesson feed contains an item without a required display field.`);
    }
    if (ids.has(lesson.id)) throw new Error(`${language} lesson feed contains duplicate id ${lesson.id}.`);
    const hasLuxartRoomNumber = Number.isSafeInteger(lesson.luxartRoomNumber) && lesson.luxartRoomNumber > 0;
    if (requireLuxartRoomNumbers && !hasLuxartRoomNumber) {
      throw new Error(`${language} lesson feed contains a lesson without a positive Luxart room number.`);
    }
    const normalizedStart = new Date(lesson.startsAt).toISOString();
    const dayKey = pragueDateKey(normalizedStart);
    if (dayKey < scheduleRange.from.slice(0, 10) || dayKey >= scheduleRange.to.slice(0, 10)) {
      throw new Error(`${language} lesson feed contains an occurrence outside the seven-day Prague range: ${dayKey}.`);
    }
    ids.add(lesson.id);
    rooms.add(lesson.roomName);
    if (hasLuxartRoomNumber) {
      roomNumbers.add(lesson.luxartRoomNumber);
      roomPlacements.push(`${lesson.id}\0${lesson.luxartRoomNumber}`);
    }
    startsAt.push(normalizedStart);
    dateKeys.add(dayKey);
    if (/reformer/i.test(`${lesson.name} ${lesson.roomName} ${lesson.category ?? ""}`)) reformer += 1;
  }
  startsAt.sort();
  if (requireReformer && reformer === 0) throw new Error(`The ${language} seven-day feed contains no Reformer lesson.`);
  return {
    ok: true,
    durationMs: result.durationMs,
    count: lessons.length,
    occurrenceSetSha256: createHash("sha256").update([...ids].sort().join("\n"), "utf8").digest("hex"),
    ...(requireLuxartRoomNumbers ? {
      roomPlacementSetSha256: createHash("sha256").update(roomPlacements.sort().join("\n"), "utf8").digest("hex"),
    } : {}),
    rooms: [...rooms].sort(),
    roomNumbers: [...roomNumbers].sort((left, right) => left - right),
    reformer,
    earliestStartsAt: startsAt[0],
    latestStartsAt: startsAt.at(-1),
    dateKeys: [...dateKeys].sort(),
  };
}

async function main() {
  const home = await timedFetch("/");
  if (home.response.status !== 200) throw new Error(`/ returned ${home.response.status}.`);
  requireHeader(home.response, "content-security-policy", "frame-ancestors 'none'");
  requireHeader(home.response, "strict-transport-security", "includeSubDomains");
  requireHeader(home.response, "x-content-type-options", "nosniff");
  evidence.checks.browserSecurity = { ok: true, durationMs: home.durationMs };

  const health = await jsonEndpoint("/api/health");
  if (health.body.status !== "ok") throw new Error("Health payload is not ok.");
  evidence.checks.health = { ok: true, durationMs: health.durationMs };

  const readiness = await jsonEndpoint("/api/readiness");
  if (readiness.body.status !== "ready") throw new Error("Runtime is not ready.");
  if (!["memory", "postgres"].includes(readiness.body.rateLimit)) {
    throw new Error("Runtime readiness does not identify an active rate-limit mode.");
  }
  if (readiness.body.mode === "live" && readiness.body.rateLimit === "memory" && process.env.PROBE_ALLOW_SINGLE_INSTANCE !== "true") {
    throw new Error("Live runtime uses an in-memory rate limit without explicit single-instance probe approval.");
  }
  if (readiness.body.mode === "live") {
    if (readiness.body.region !== "fra1") {
      throw new Error("Live runtime readiness does not prove the approved fra1 deployment region.");
    }
    if (!["read_only", "booking_without_payments", "booking_with_stripe"].includes(readiness.body.phase)) {
      throw new Error("Live runtime readiness does not identify an approved deployment phase.");
    }
    if (!/^[a-f0-9]{40}$/i.test(readiness.body.commit ?? "")) {
      throw new Error("Live runtime readiness does not identify the exact deployment commit.");
    }
    if (readiness.body.luxart !== "reachable" || readiness.body.schedule !== "ready") {
      throw new Error("Live runtime readiness does not confirm a valid non-empty seven-day Luxart schedule.");
    }
    if (readiness.body.bookingNotifications !== "ready") {
      throw new Error("Live runtime readiness does not confirm active Luxart booking notification templates.");
    }
  }
  evidence.checks.readiness = {
    ok: true,
    durationMs: readiness.durationMs,
    mode: readiness.body.mode,
    phase: readiness.body.phase,
    commit: readiness.body.commit,
    region: readiness.body.region,
    luxart: readiness.body.luxart,
    schedule: readiness.body.schedule,
    bookingNotifications: readiness.body.bookingNotifications,
    rateLimit: readiness.body.rateLimit,
    booking: readiness.body.booking,
    payments: readiness.body.payments,
    capabilities: readiness.body.capabilities,
  };

  const [czechResult, englishResult] = await Promise.all([
    jsonEndpoint("/api/lessons", 200, { headers: { "X-Zone4You-Locale": "cs" } }),
    jsonEndpoint("/api/lessons", 200, { headers: { "X-Zone4You-Locale": "en" } }),
  ]);
  const requireLuxartRoomNumbers = readiness.body.mode === "live";
  const czech = lessonFeedEvidence(czechResult, "Czech", requireLuxartRoomNumbers);
  const english = lessonFeedEvidence(englishResult, "English", requireLuxartRoomNumbers);
  if (
    czech.count !== english.count ||
    czech.occurrenceSetSha256 !== english.occurrenceSetSha256 ||
    (requireLuxartRoomNumbers && czech.roomPlacementSetSha256 !== english.roomPlacementSetSha256)
  ) {
    throw new Error("Czech and English application feeds do not contain the same lesson occurrences and room placements.");
  }
  evidence.checks.lessons = {
    ok: true,
    durationMs: Math.max(czechResult.durationMs, englishResult.durationMs),
    range: scheduleRange,
    count: czech.count,
    occurrenceSetSha256: czech.occurrenceSetSha256,
    ...(requireLuxartRoomNumbers ? {
      roomPlacementSetSha256: czech.roomPlacementSetSha256,
      roomNumbers: czech.roomNumbers,
    } : {}),
    rooms: czech.rooms,
    reformer: czech.reformer,
    czech,
    english,
  };

  console.log(JSON.stringify({ ok: true, ...evidence }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, ...evidence, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
