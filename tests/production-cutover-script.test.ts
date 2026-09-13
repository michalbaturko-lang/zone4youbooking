import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadProductionCutoverConfig,
  runProductionCutoverVerification,
  writeProductionCutoverEvidence,
} from "../scripts/verify-production-cutover";
import { lessonContentSetSha256 } from "../scripts/lesson-content-evidence.mjs";
import type { Lesson } from "../src/lib/domain";
import { zone4YouScheduleRange } from "../src/lib/zone4YouTime";

const commit = "1234567890abcdef1234567890abcdef12345678";
const target = "https://booking.zone4you.cz/";
const checkedAt = new Date("2026-08-30T10:00:00.000Z");
const dossierSha256 = "a".repeat(64);
const baselineSha256 = "b".repeat(64);
const fixtureDirectory = mkdtempSync(join(tmpdir(), "zone4you-cutover-"));
chmodSync(fixtureDirectory, 0o700);
let fixtureCounter = 0;
const range = zone4YouScheduleRange(checkedAt, 7);
const approvedOccurrenceSetSha256 = createHash("sha256").update("lesson-1").digest("hex");
const approvedRoomPlacementSetSha256 = createHash("sha256").update("lesson-1\0" + 4).digest("hex");
const approvedResourceMapSha256 = "e".repeat(64);

function preCutoverFixture(
  overrides: Record<string, unknown> = {},
  mode = 0o600,
) {
  const receipt = {
    ok: true,
    checkedAt: checkedAt.toISOString(),
    cutoverApprovedAt: new Date(checkedAt.getTime() - 5 * 60_000).toISOString(),
    decision: "GO_TO_AUTHORIZED_DNS_CHANGE",
    target: "https://booking.zone4you.cz",
    releaseId: "zone4you-pilot-2026-08-30",
    commit,
    launchMode: "booking_without_payments",
    dossierSha256,
    lessonFeed: {
      count: 1,
      occurrenceSetSha256: approvedOccurrenceSetSha256,
      roomPlacementSetSha256: approvedRoomPlacementSetSha256,
      localizedContentSha256: {
        czech: approvedLessonContentSetSha256,
        english: approvedLessonContentSetSha256,
      },
      resourceMapSha256: approvedResourceMapSha256,
      roomNumbers: [4],
      reformer: 1,
      range: { ...range, days: 7, timeZone: "Europe/Prague" },
      earliestStartsAt: `${range.from.slice(0, 10)}T10:00:00.000Z`,
      latestStartsAt: `${range.from.slice(0, 10)}T10:00:00.000Z`,
      dateKeys: [range.from.slice(0, 10)],
    },
    dns: {
      baselineFileSha256: baselineSha256,
      unchangedSinceCapture: true,
      rollbackReady: true,
    },
    explicitCutoverApproval: true,
    ...overrides,
  };
  const path = join(fixtureDirectory, `precutover-${fixtureCounter += 1}.json`);
  const body = `${JSON.stringify(receipt, null, 2)}\n`;
  writeFileSync(path, body, { encoding: "utf8", mode });
  const sha256 = createHash("sha256").update(body).digest("hex");
  return { path, receipt, sha256 };
}

test.after(() => rmSync(fixtureDirectory, { recursive: true, force: true }));

function lesson(id: string, startsAt = `${range.from.slice(0, 10)}T10:00:00.000Z`): Lesson {
  return {
    id,
    luxartRoomNumber: 4,
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

const approvedLessonContentSetSha256 = lessonContentSetSha256(
  [lesson("lesson-1")],
  "Approved production test lesson feed",
);
const approvedPreCutover = preCutoverFixture();
const baseEnvironment = {
  ZONE4YOU_PRODUCTION_APP_URL: target,
  ZONE4YOU_PRODUCTION_EXPECTED_COMMIT: commit,
  ZONE4YOU_PRODUCTION_EXPECTED_PHASE: "booking_without_payments",
  ZONE4YOU_PRECUTOVER_EVIDENCE_PATH: approvedPreCutover.path,
  ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION: `VERIFY_ZONE4YOU_RELEASE_DOSSIER:${dossierSha256}`,
  ZONE4YOU_PRODUCTION_CUTOVER_CONFIRMATION: `VERIFY_ZONE4YOU_PRODUCTION_CUTOVER:${approvedPreCutover.sha256}`,
} satisfies Record<string, string | undefined>;

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
        bookingNotifications: "ready",
        resourceMapSha256: approvedResourceMapSha256,
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
    () => loadProductionCutoverConfig({ ...baseEnvironment, ZONE4YOU_PRODUCTION_APP_URL: "https://example.com/" }, checkedAt),
    /must exactly equal/i,
  );
  assert.throws(
    () => loadProductionCutoverConfig({ ...baseEnvironment, ZONE4YOU_PRODUCTION_EXPECTED_COMMIT: "short" }, checkedAt),
    /40-character Git SHA/i,
  );
  assert.throws(
    () => loadProductionCutoverConfig({ ...baseEnvironment, ZONE4YOU_PRODUCTION_EXPECTED_PHASE: "read_only" }, checkedAt),
    /booking_without_payments or booking_with_stripe/i,
  );
  assert.throws(
    () => loadProductionCutoverConfig({ ...baseEnvironment, ZONE4YOU_PRODUCTION_CUTOVER_CONFIRMATION: "YES" }, checkedAt),
    /must exactly equal/i,
  );
  const config = loadProductionCutoverConfig(baseEnvironment, checkedAt);
  assert.equal(config.maxDurationMs, 60_000);
  assert.equal(config.preCutoverEvidenceSha256, approvedPreCutover.sha256);
  assert.equal(config.dossierSha256, dossierSha256);
  assert.equal(config.cutoverApprovedAt, new Date(checkedAt.getTime() - 5 * 60_000).toISOString());
  assert.equal(config.approvedLessonFeed.occurrenceSetSha256, approvedOccurrenceSetSha256);
  assert.equal(config.approvedLessonFeed.roomPlacementSetSha256, approvedRoomPlacementSetSha256);
  assert.equal(config.approvedLessonFeed.localizedContentSha256.czech, approvedLessonContentSetSha256);
  assert.equal(config.approvedLessonFeed.resourceMapSha256, approvedResourceMapSha256);
  assert.deepEqual(config.approvedLessonFeed.roomNumbers, [4]);
  assert.equal(config.approvedLessonFeed.count, 1);
});

test("production cutover configuration rejects stale, mismatched or weakly protected pre-cutover evidence", () => {
  const stale = preCutoverFixture({
    checkedAt: new Date(checkedAt.getTime() - 31 * 60_000).toISOString(),
    cutoverApprovedAt: new Date(checkedAt.getTime() - 32 * 60_000).toISOString(),
  });
  assert.throws(
    () => loadProductionCutoverConfig({
      ...baseEnvironment,
      ZONE4YOU_PRECUTOVER_EVIDENCE_PATH: stale.path,
      ZONE4YOU_PRODUCTION_CUTOVER_CONFIRMATION: `VERIFY_ZONE4YOU_PRODUCTION_CUTOVER:${stale.sha256}`,
    }, checkedAt),
    /stale/i,
  );

  const beforeApproval = preCutoverFixture({
    cutoverApprovedAt: new Date(checkedAt.getTime() + 60_000).toISOString(),
  });
  assert.throws(
    () => loadProductionCutoverConfig({
      ...baseEnvironment,
      ZONE4YOU_PRECUTOVER_EVIDENCE_PATH: beforeApproval.path,
      ZONE4YOU_PRODUCTION_CUTOVER_CONFIRMATION: `VERIFY_ZONE4YOU_PRODUCTION_CUTOVER:${beforeApproval.sha256}`,
    }, checkedAt),
    /predates the final cutover approval/i,
  );

  const futureReceipt = preCutoverFixture({
    checkedAt: new Date(checkedAt.getTime() + 1).toISOString(),
  });
  assert.throws(
    () => loadProductionCutoverConfig({
      ...baseEnvironment,
      ZONE4YOU_PRECUTOVER_EVIDENCE_PATH: futureReceipt.path,
      ZONE4YOU_PRODUCTION_CUTOVER_CONFIRMATION: `VERIFY_ZONE4YOU_PRODUCTION_CUTOVER:${futureReceipt.sha256}`,
    }, checkedAt),
    /must not predate the pre-cutover evidence/i,
  );

  const wrongCommit = preCutoverFixture({ commit: "f".repeat(40) });
  assert.throws(
    () => loadProductionCutoverConfig({
      ...baseEnvironment,
      ZONE4YOU_PRECUTOVER_EVIDENCE_PATH: wrongCommit.path,
      ZONE4YOU_PRODUCTION_CUTOVER_CONFIRMATION: `VERIFY_ZONE4YOU_PRODUCTION_CUTOVER:${wrongCommit.sha256}`,
    }, checkedAt),
    /does not match the approved production release/i,
  );

  const wrongDossier = preCutoverFixture({ dossierSha256: "c".repeat(64) });
  assert.throws(
    () => loadProductionCutoverConfig({
      ...baseEnvironment,
      ZONE4YOU_PRECUTOVER_EVIDENCE_PATH: wrongDossier.path,
      ZONE4YOU_PRODUCTION_CUTOVER_CONFIRMATION: `VERIFY_ZONE4YOU_PRODUCTION_CUTOVER:${wrongDossier.sha256}`,
    }, checkedAt),
    /release_dossier_confirmation must exactly equal/i,
  );

  const insecure = preCutoverFixture({}, 0o644);
  assert.throws(
    () => loadProductionCutoverConfig({
      ...baseEnvironment,
      ZONE4YOU_PRECUTOVER_EVIDENCE_PATH: insecure.path,
      ZONE4YOU_PRODUCTION_CUTOVER_CONFIRMATION: `VERIFY_ZONE4YOU_PRODUCTION_CUTOVER:${insecure.sha256}`,
    }, checkedAt),
    /must not be accessible by group or other users/i,
  );

  const symlinkPath = join(fixtureDirectory, "precutover-link.json");
  symlinkSync(approvedPreCutover.path, symlinkPath);
  assert.throws(
    () => loadProductionCutoverConfig({
      ...baseEnvironment,
      ZONE4YOU_PRECUTOVER_EVIDENCE_PATH: symlinkPath,
    }, checkedAt),
    /not a symlink/i,
  );

  const incompleteLessonFeed = preCutoverFixture({
    lessonFeed: { count: 1, occurrenceSetSha256: approvedOccurrenceSetSha256 },
  });
  assert.throws(
    () => loadProductionCutoverConfig({
      ...baseEnvironment,
      ZONE4YOU_PRECUTOVER_EVIDENCE_PATH: incompleteLessonFeed.path,
      ZONE4YOU_PRODUCTION_CUTOVER_CONFIRMATION:
        `VERIFY_ZONE4YOU_PRODUCTION_CUTOVER:${incompleteLessonFeed.sha256}`,
    }, checkedAt),
    /approved lesson feed is incomplete or invalid/i,
  );
});

test("production cutover verifier proves DNS, security, runtime provenance and matching CS/EN lesson feeds", async () => {
  const evidence = await runProductionCutoverVerification(
    loadProductionCutoverConfig(baseEnvironment, checkedAt),
    {
      fetchImpl: liveFetch(),
      resolveAnyImpl: async () => [{ type: "A", address: "203.0.113.10", ttl: 60 }],
      now: () => checkedAt,
    },
  );

  assert.equal(evidence.ok, true);
  assert.equal(evidence.expectedCommit, commit);
  assert.equal(evidence.dossierSha256, dossierSha256);
  assert.equal(evidence.cutoverApprovedAt, approvedPreCutover.receipt.cutoverApprovedAt);
  assert.equal(evidence.preCutoverEvidenceSha256, approvedPreCutover.sha256);
  assert.equal(evidence.lessons.count, 1);
  assert.equal(evidence.lessons.reformer, 1);
  assert.equal(evidence.readiness.region, "fra1");
  assert.equal(evidence.readiness.schedule, "ready");
  assert.equal(evidence.readiness.bookingNotifications, "ready");
  assert.equal(evidence.readiness.resourceMapSha256, approvedResourceMapSha256);
  assert.deepEqual(evidence.dns.recordTypes, ["A"]);
  assert.equal(evidence.requestIds.lessonsCs, "lessons-cs");
  assert.equal(evidence.requestIds.lessonsEn, "lessons-en");
  assert.equal(JSON.stringify(evidence).includes("203.0.113.10"), false);
});

test("production cutover writes one immutable owner-only release receipt outside the repository", async () => {
  const outputPath = join(fixtureDirectory, `production-cutover-${fixtureCounter += 1}.json`);
  const receipt = await writeProductionCutoverEvidence({
    environment: {
      ...baseEnvironment,
      ZONE4YOU_PRODUCTION_CUTOVER_EVIDENCE_OUTPUT_PATH: outputPath,
    },
    fetchImpl: liveFetch(),
    resolveAnyImpl: async () => [{ type: "A", address: "203.0.113.10", ttl: 60 }],
    now: checkedAt,
  });

  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.evidenceStoredOwnerOnly, true);
  assert.match(receipt.evidenceSha256, /^[a-f0-9]{64}$/);
  assert.equal(statSync(outputPath).mode & 0o777, 0o600);
  const stored = JSON.parse(readFileSync(outputPath, "utf8")) as Record<string, unknown>;
  assert.equal(stored.schemaVersion, 1);
  assert.equal(stored.preCutoverEvidenceSha256, approvedPreCutover.sha256);
  assert.equal(stored.expectedCommit, commit);
  assert.equal("evidenceSha256" in stored, false);

  await assert.rejects(
    writeProductionCutoverEvidence({
      environment: {
        ...baseEnvironment,
        ZONE4YOU_PRODUCTION_CUTOVER_EVIDENCE_OUTPUT_PATH: outputPath,
      },
      fetchImpl: liveFetch(),
      resolveAnyImpl: async () => [{ type: "A", address: "203.0.113.10", ttl: 60 }],
      now: checkedAt,
    }),
    /already exists and will not be overwritten/i,
  );
});

test("production cutover refuses to store its release receipt inside the repository", async () => {
  await assert.rejects(
    writeProductionCutoverEvidence({
      environment: {
        ...baseEnvironment,
        ZONE4YOU_PRODUCTION_CUTOVER_EVIDENCE_OUTPUT_PATH: join(fixtureDirectory, "inside-repository.json"),
      },
      repositoryRoot: fixtureDirectory,
      fetchImpl: liveFetch(),
      resolveAnyImpl: async () => [{ type: "A", address: "203.0.113.10", ttl: 60 }],
      now: checkedAt,
    }),
    /must be stored outside the repository/i,
  );
});

test("production verifier independently enforces the approved chronology", async () => {
  const config = loadProductionCutoverConfig(baseEnvironment, checkedAt);
  await assert.rejects(
    runProductionCutoverVerification(
      {
        ...config,
        preCutoverCheckedAt: new Date(checkedAt.getTime() + 1).toISOString(),
      },
      {
        fetchImpl: liveFetch(),
        resolveAnyImpl: async () => [{ type: "A", address: "203.0.113.10", ttl: 60 }],
        now: () => checkedAt,
      },
    ),
    /chronology is invalid/i,
  );
});

test("production verifier independently validates the approved lesson snapshot and its Prague range", async () => {
  const config = loadProductionCutoverConfig(baseEnvironment, checkedAt);
  const dependencies = {
    fetchImpl: liveFetch(),
    resolveAnyImpl: async () => [{ type: "A" as const, address: "203.0.113.10", ttl: 60 }],
    now: () => checkedAt,
  };
  await assert.rejects(
    runProductionCutoverVerification({
      ...config,
      approvedLessonFeed: { ...config.approvedLessonFeed, count: 0 },
    }, dependencies),
    /approved lesson feed is incomplete or invalid/i,
  );

  await assert.rejects(
    runProductionCutoverVerification(config, {
      ...dependencies,
      now: () => new Date(checkedAt.getTime() + 24 * 60 * 60_000),
    }),
    /no longer covers the approved lesson range/i,
  );
});

test("production verifier rejects any lesson omission or drift from the approved live feed", async () => {
  const config = loadProductionCutoverConfig(baseEnvironment, checkedAt);
  await assert.rejects(
    runProductionCutoverVerification(
      {
        ...config,
        approvedLessonFeed: {
          ...config.approvedLessonFeed,
          count: 2,
          occurrenceSetSha256: createHash("sha256")
            .update(["lesson-1", "lesson-2"].sort().join("\n"))
            .digest("hex"),
        },
      },
      {
        fetchImpl: liveFetch([lesson("lesson-1")]),
        resolveAnyImpl: async () => [{ type: "A", address: "203.0.113.10", ttl: 60 }],
        now: () => checkedAt,
      },
    ),
    /does not exactly match the approved live Luxart and staging lesson evidence/i,
  );

  await assert.rejects(
    runProductionCutoverVerification(config, {
      fetchImpl: liveFetch([{ ...lesson("lesson-1"), priceKc: 250 }]),
      resolveAnyImpl: async () => [{ type: "A", address: "203.0.113.10", ttl: 60 }],
      now: () => checkedAt,
    }),
    /does not exactly match the approved live Luxart and staging lesson evidence/i,
  );
});

test("production verifier rejects room placement drift even when lesson IDs are unchanged", async () => {
  const config = loadProductionCutoverConfig(baseEnvironment, checkedAt);
  await assert.rejects(
    runProductionCutoverVerification(config, {
      fetchImpl: liveFetch([{ ...lesson("lesson-1"), luxartRoomNumber: 5 }]),
      resolveAnyImpl: async () => [{ type: "A", address: "203.0.113.10", ttl: 60 }],
      now: () => checkedAt,
    }),
    /does not exactly match the approved live Luxart and staging lesson evidence/i,
  );
});

test("production cutover verifier fails closed on DNS, runtime or schedule divergence", async () => {
  const config = loadProductionCutoverConfig(baseEnvironment, checkedAt);
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

  const unconfirmedNotificationsFetch: typeof fetch = async (input, init) => {
    const result = await liveFetch()(input, init);
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.pathname !== "/api/readiness") return result;
    const body = await result.json() as Record<string, unknown>;
    return response({ ...body, bookingNotifications: "unconfirmed" }, "readiness-unconfirmed-notifications");
  };
  await assert.rejects(
    runProductionCutoverVerification(config, {
      fetchImpl: unconfirmedNotificationsFetch,
      resolveAnyImpl: async () => [{ type: "CNAME", value: "pilot.invalid" }],
      now: () => checkedAt,
    }),
    /booking notifications/i,
  );

  const wrongResourceMapFetch: typeof fetch = async (input, init) => {
    const result = await liveFetch()(input, init);
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.pathname !== "/api/readiness") return result;
    const body = await result.json() as Record<string, unknown>;
    return response({ ...body, resourceMapSha256: "f".repeat(64) }, "readiness-wrong-resource-map");
  };
  await assert.rejects(
    runProductionCutoverVerification(config, {
      fetchImpl: wrongResourceMapFetch,
      resolveAnyImpl: async () => [{ type: "CNAME", value: "pilot.invalid" }],
      now: () => checkedAt,
    }),
    /resource mapping/i,
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
