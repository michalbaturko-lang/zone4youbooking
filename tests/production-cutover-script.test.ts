import assert from "node:assert/strict";
import test from "node:test";
import {
  loadProductionCutoverConfig,
  runProductionCutoverVerification,
} from "../scripts/verify-production-cutover";
import type { Lesson } from "../src/lib/domain";
import { zone4YouScheduleRange } from "../src/lib/zone4YouTime";

const commit = "1234567890abcdef1234567890abcdef12345678";
const target = "https://booking.zone4you.cz/";
const baseEnvironment = {
  ZONE4YOU_PRODUCTION_APP_URL: target,
  ZONE4YOU_PRODUCTION_EXPECTED_COMMIT: commit,
  ZONE4YOU_PRODUCTION_EXPECTED_PHASE: "booking_without_payments",
  ZONE4YOU_PRODUCTION_CUTOVER_CONFIRMATION: `VERIFY_ZONE4YOU_PRODUCTION_CUTOVER:${commit}`,
} satisfies Record<string, string | undefined>;

const checkedAt = new Date("2026-08-30T10:00:00.000Z");
const range = zone4YouScheduleRange(checkedAt, 7);

function lesson(id: string, startsAt = `${range.from.slice(0, 10)}T10:00:00.000Z`): Lesson {
  return {
    id,
    name: "Reformer pilates",
    description: "Pilot lesson",
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + 60 * 60 * 1_000).toISOString(),
    durationMinutes: 60,
    instructorName: "Pilot instructor",
    instructorSpecialization: "Pilates",
    roomName: "Reformer",
    category: "Pilates",
    capacity: 10,
    occupiedCount: 2,
    priceKc: 200,
    waitlistEnabled: false,
  };
}

function response(body: unknown, requestId: string, status = 200, html = false) {
  return new Response(html ? String(body) : JSON.stringify(body), {
    status,
    headers: html ? {
      "Content-Type": "text/html",
      "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
      "X-Content-Type-Options": "nosniff",
    } : {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Request-ID": requestId,
    },
  });
}

function liveFetch(lessons = [lesson("lesson-1")]): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.pathname === "/") return response("<!doctype html>", "unused", 200, true);
    if (url.pathname === "/api/health") return response({ status: "ok" }, "health-1");
    if (url.pathname === "/api/readiness") {
      return response({
        status: "ready",
        mode: "live",
        phase: "booking_without_payments",
        commit,
        region: "fra1",
        luxart: "reachable",
        schedule: "ready",
        rateLimit: "postgres",
        booking: "ready",
        payments: "disabled",
        capabilities: {
          reservationsEnabled: true,
          waitlistEnabled: false,
          topupsEnabled: false,
          topupMode: "disabled",
          businessRulesStatus: "confirmed",
          favoritesSync: "device",
          forgotPasswordEnabled: false,
          englishEnabled: true,
        },
      }, "readiness-1");
    }
    if (url.pathname === "/api/lessons") {
      const locale = new Headers(init?.headers).get("x-zone4you-locale");
      return response({ lessons }, `lessons-${locale}`);
    }
    return response({}, "unknown", 404);
  };
}

test("production cutover configuration is pinned to the exact host, commit, phase and confirmation", () => {
  assert.throws(
    () => loadProductionCutoverConfig({ ...baseEnvironment, ZONE4YOU_PRODUCTION_APP_URL: "https://example.com/" }),
    /must exactly equal/i,
  );
  assert.throws(
    () => loadProductionCutoverConfig({ ...baseEnvironment, ZONE4YOU_PRODUCTION_EXPECTED_COMMIT: "short" }),
    /40-character Git SHA/i,
  );
  assert.throws(
    () => loadProductionCutoverConfig({ ...baseEnvironment, ZONE4YOU_PRODUCTION_EXPECTED_PHASE: "read_only" }),
    /booking_without_payments or booking_with_stripe/i,
  );
  assert.throws(
    () => loadProductionCutoverConfig({ ...baseEnvironment, ZONE4YOU_PRODUCTION_CUTOVER_CONFIRMATION: "YES" }),
    /must exactly equal/i,
  );
  assert.equal(loadProductionCutoverConfig(baseEnvironment).maxDurationMs, 60_000);
});

test("production cutover verifier proves DNS, security, runtime provenance and matching CS/EN lesson feeds", async () => {
  const evidence = await runProductionCutoverVerification(
    loadProductionCutoverConfig(baseEnvironment),
    {
      fetchImpl: liveFetch(),
      resolveAnyImpl: async () => [{ type: "A", address: "203.0.113.10", ttl: 60 }],
      now: () => checkedAt,
    },
  );

  assert.equal(evidence.ok, true);
  assert.equal(evidence.expectedCommit, commit);
  assert.equal(evidence.lessons.count, 1);
  assert.equal(evidence.lessons.reformer, 1);
  assert.equal(evidence.readiness.region, "fra1");
  assert.equal(evidence.readiness.schedule, "ready");
  assert.deepEqual(evidence.dns.recordTypes, ["A"]);
  assert.equal(evidence.requestIds.lessonsCs, "lessons-cs");
  assert.equal(evidence.requestIds.lessonsEn, "lessons-en");
  assert.equal(JSON.stringify(evidence).includes("203.0.113.10"), false);
});

test("production cutover verifier fails closed on DNS, runtime or schedule divergence", async () => {
  const config = loadProductionCutoverConfig(baseEnvironment);
  await assert.rejects(
    runProductionCutoverVerification(config, {
      fetchImpl: liveFetch(),
      resolveAnyImpl: async () => [],
      now: () => checkedAt,
    }),
    /no A, AAAA or CNAME/i,
  );

  const wrongCommitFetch: typeof fetch = async (input, init) => {
    const result = await liveFetch()(input, init);
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.pathname !== "/api/readiness") return result;
    const body = await result.json() as Record<string, unknown>;
    return response({ ...body, commit: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" }, "readiness-wrong");
  };
  await assert.rejects(
    runProductionCutoverVerification(config, {
      fetchImpl: wrongCommitFetch,
      resolveAnyImpl: async () => [{ type: "CNAME", value: "pilot.invalid" }],
      now: () => checkedAt,
    }),
    /does not match the approved commit/i,
  );

  const wrongRegionFetch: typeof fetch = async (input, init) => {
    const result = await liveFetch()(input, init);
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.pathname !== "/api/readiness") return result;
    const body = await result.json() as Record<string, unknown>;
    return response({ ...body, region: "iad1" }, "readiness-wrong-region");
  };
  await assert.rejects(
    runProductionCutoverVerification(config, {
      fetchImpl: wrongRegionFetch,
      resolveAnyImpl: async () => [{ type: "CNAME", value: "pilot.invalid" }],
      now: () => checkedAt,
    }),
    /fra1 region/i,
  );

  const emptyScheduleFetch: typeof fetch = async (input, init) => {
    const result = await liveFetch()(input, init);
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.pathname !== "/api/readiness") return result;
    const body = await result.json() as Record<string, unknown>;
    return response({ ...body, schedule: "empty" }, "readiness-empty-schedule");
  };
  await assert.rejects(
    runProductionCutoverVerification(config, {
      fetchImpl: emptyScheduleFetch,
      resolveAnyImpl: async () => [{ type: "CNAME", value: "pilot.invalid" }],
      now: () => checkedAt,
    }),
    /readiness does not match/i,
  );

  const outsideRange = lesson("lesson-outside", `${range.to.slice(0, 10)}T10:00:00.000Z`);
  await assert.rejects(
    runProductionCutoverVerification(config, {
      fetchImpl: liveFetch([outsideRange]),
      resolveAnyImpl: async () => [{ type: "AAAA", address: "2001:db8::1", ttl: 60 }],
      now: () => checkedAt,
    }),
    /outside the seven-day Prague range/i,
  );
});
