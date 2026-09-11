import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyPilotReleaseEvidence } from "../scripts/verify-pilot-release";

const now = new Date("2026-09-05T08:00:00.000Z");
const commit = "1234567890abcdef1234567890abcdef12345678";
const stagingTarget = "https://staging.booking.zone4you.cz";
const luxartTarget = "https://luxart-test.example.com:9759";
const occurrenceSetSha256 = "a".repeat(64);

function writeJson(path: string, value: unknown) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, body, "utf8");
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function validFixture() {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-release-evidence-"));
  const checkedAt = "2026-09-05T07:30:00.000Z";
  const files: Record<string, unknown> = {
    luxartReadOnly: {
      ok: true,
      checkedAt,
      target: luxartTarget,
      gatewayAuthMode: "none",
      range: {
        from: "2026-09-05T00:00:00.000Z",
        to: "2026-09-12T00:00:00.000Z",
        days: 7,
        timeZone: "Europe/Prague",
      },
      czech: {
        count: 24,
        occurrenceSetSha256,
        rooms: ["Sál 1", "Sál 2", "Reformer"],
        roomNumbers: [1, 2, 3],
        reformer: 3,
        earliestStartsAt: "2026-09-05T08:00:00.000Z",
        latestStartsAt: "2026-09-11T18:00:00.000Z",
        dateKeys: ["2026-09-05", "2026-09-11"],
      },
      english: {
        count: 24,
        occurrenceSetSha256,
        rooms: ["Studio 1", "Studio 2", "Reformer"],
        roomNumbers: [1, 2, 3],
        reformer: 3,
        earliestStartsAt: "2026-09-05T08:00:00.000Z",
        latestStartsAt: "2026-09-11T18:00:00.000Z",
        dateKeys: ["2026-09-05", "2026-09-11"],
      },
      authenticated: { checked: true, userLoaded: true, reservations: 0, creditTransactions: 2 },
      personalized: {
        checked: true,
        czech: { count: 24, occurrenceSetSha256, eligible: 22, ineligible: 2 },
        english: { count: 24, occurrenceSetSha256, eligible: 22, ineligible: 2 },
      },
    },
    runtimeProbe: {
      ok: true,
      checkedAt,
      target: stagingTarget,
      checks: {
        browserSecurity: { ok: true },
        health: { ok: true },
        readiness: {
          ok: true,
          mode: "live",
          phase: "booking_without_payments",
          commit,
          region: "fra1",
          luxart: "reachable",
          schedule: "ready",
          rateLimit: "memory",
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
        },
        lessons: {
          ok: true,
          range: {
            from: "2026-09-05T00:00:00.000Z",
            to: "2026-09-12T00:00:00.000Z",
            days: 7,
            timeZone: "Europe/Prague",
          },
          count: 24,
          occurrenceSetSha256,
          reformer: 3,
          czech: {
            ok: true,
            count: 24,
            occurrenceSetSha256,
            reformer: 3,
            earliestStartsAt: "2026-09-05T08:00:00.000Z",
            latestStartsAt: "2026-09-11T18:00:00.000Z",
            dateKeys: ["2026-09-05", "2026-09-11"],
          },
          english: {
            ok: true,
            count: 24,
            occurrenceSetSha256,
            reformer: 3,
            earliestStartsAt: "2026-09-05T08:00:00.000Z",
            latestStartsAt: "2026-09-11T18:00:00.000Z",
            dateKeys: ["2026-09-05", "2026-09-11"],
          },
        },
      },
    },
    bookingMutationUat: {
      ok: true,
      checkedAt,
      target: stagingTarget,
      deploymentProvenanceVerified: true,
      commit,
      phase: "booking_without_payments",
      region: "fra1",
      userVerified: true,
      personalizedEligibilityVerified: true,
      authoritativeAvailabilityVerified: true,
      reservationWindowVerified: true,
      onlineCancellationVerified: true,
      lessonRoomNumber: 1,
      lessonIdSha256: "c".repeat(16),
      reservationIdSha256: "d".repeat(16),
      expectedCancellationFeeKc: 0,
      sameKeyCreateReplays: 3,
      parallelCreateRequests: 2,
      sameKeyCancellationReplays: 3,
      crossKeyCancellationReplay: true,
      oneActiveReservationObserved: true,
      preExistingActiveReservationsPreserved: true,
      finalStateRestored: true,
      cancellationFeeMatched: true,
      requestIds: Array.from({ length: 12 }, (_, index) => `request-${index}`),
    },
    rollback: {
      ok: true,
      checkedAt,
      target: stagingTarget,
      durationMs: 14_000,
      maximumDurationMs: 300_000,
      lessonCount: 24,
      healthReady: true,
      luxartReadable: true,
      bookingReadOnly: true,
      waitlistReadOnly: true,
      paymentsDisabled: true,
      requestIds: Array.from({ length: 7 }, (_, index) => `rollback-request-${index}`),
    },
    dnsRollbackBaseline: {
      schemaVersion: 1,
      ok: true,
      checkedAt,
      hostname: "booking.zone4you.cz",
      records: [{ type: "A", address: "203.0.113.10" }],
      recordSetSha256: "d941c237381b8d932e810d95fefde01e79b336168fd2cf483ea709b792615511",
      rollbackReady: true,
    },
    alertDelivery: {
      ok: true,
      checkedAt,
      applicationOrigin: stagingTarget,
      eventId: "da7a9313-19f9-4338-b15e-0d129364b7ee",
      alertTargetFingerprint: "0123456789abcdef",
      supportOwnerConfigured: true,
      responseStatus: 202,
      manualReceiptConfirmationRequired: true,
    },
  };

  const artifacts = Object.fromEntries(
    Object.entries(files).map(([name, value]) => {
      const path = join(directory, `${name}.json`);
      return [name, { path, sha256: writeJson(path, value) }];
    }),
  );
  chmodSync(artifacts.dnsRollbackBaseline.path, 0o600);
  const dossier = {
    schemaVersion: 2,
    draft: false,
    releaseId: "zone4you-pilot-2026-09-05",
    target: "https://booking.zone4you.cz/",
    stagingTarget: `${stagingTarget}/`,
    luxartOrigin: `${luxartTarget}/`,
    commit,
    launchMode: "booking_without_payments",
    maximumEvidenceAgeHours: 72,
    launchWindow: {
      startsAt: "2026-09-05T08:00:00.000Z",
      endsAt: "2026-09-05T12:00:00.000Z",
    },
    artifacts,
    approvals: {
      uat: {
        decision: "GO",
        openP0: 0,
        openP1: 0,
        approvedBy: "Zone4You pilot owner",
        approvedAt: "2026-09-05T07:45:00.000Z",
      },
      alertReceipt: {
        confirmed: true,
        eventId: "da7a9313-19f9-4338-b15e-0d129364b7ee",
        approvedBy: "Zone4You reception",
        approvedAt: "2026-09-05T07:40:00.000Z",
      },
      memberzoneFallback: {
        available: true,
        approvedBy: "Zone4You reception",
        approvedAt: "2026-09-05T07:40:00.000Z",
      },
      cutover: {
        approved: true,
        approvedBy: "Zone4You release owner",
        approvedAt: "2026-09-05T07:50:00.000Z",
      },
    },
  };
  const dossierPath = join(directory, "pilot-release-dossier.json");
  const dossierSha = writeJson(dossierPath, dossier);
  const environment = {
    ZONE4YOU_RELEASE_DOSSIER_PATH: dossierPath,
    ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION: `VERIFY_ZONE4YOU_RELEASE_DOSSIER:${dossierSha}`,
    ZONE4YOU_RELEASE_COMMIT: commit,
    LUXART_RESOURCE_MAP_JSON: JSON.stringify({ 1: 101, 2: 102, 3: 203 }),
    LUXART_API_AUTH_MODE: "none",
    LUXART_API_AUTH_CONFIRMED: "true",
    RATE_LIMIT_MODE: "memory",
    RATE_LIMIT_SINGLE_INSTANCE: "true",
  };
  return { directory, dossier, dossierPath, files, environment };
}

test("pilot release dossier binds live Luxart, UAT, application and DNS rollback, alert and cutover approval", () => {
  const fixture = validFixture();
  const result = verifyPilotReleaseEvidence(fixture.environment, now);
  assert.equal(result.ok, true);
  assert.equal(result.conditions.fullLessonFeedMatched, true);
  assert.equal(result.conditions.personalizedEligibilityVerified, true);
  assert.equal(result.conditions.exactSevenDayPragueRangeVerified, true);
  assert.equal(result.conditions.dnsRollbackBaselineReady, true);
  assert.equal(result.conditions.explicitCutoverApproval, true);
  assert.equal(result.paymentsIncluded, false);
  assert.equal(result.artifacts.length, 6);
  assert.equal(JSON.stringify(result).includes("approvedBy"), false);
  assert.equal(JSON.stringify(result).includes(fixture.dossierPath), false);
  chmodSync(fixture.dossier.artifacts.dnsRollbackBaseline.path, 0o644);
  assert.throws(
    () => verifyPilotReleaseEvidence(fixture.environment, now),
    /dnsRollbackBaseline must not be accessible/i,
  );
});

test("pilot release dossier rejects evidence that cannot come from the real guarded producers", () => {
  for (const [artifactName, mutate, expectedError] of [
    [
      "luxartReadOnly",
      (artifact: Record<string, unknown>) => {
        const personalized = artifact.personalized as { english: Record<string, unknown> };
        personalized.english.eligible = 23;
        personalized.english.ineligible = 1;
      },
      /Czech and English personalized Luxart eligibility counts differ/i,
    ],
    [
      "bookingMutationUat",
      (artifact: Record<string, unknown>) => {
        artifact.authoritativeAvailabilityVerified = false;
      },
      /booking UAT authoritativeAvailabilityVerified must be true/i,
    ],
    [
      "bookingMutationUat",
      (artifact: Record<string, unknown>) => {
        artifact.commit = "b".repeat(40);
      },
      /booking UAT commit must exactly equal/i,
    ],
    [
      "bookingMutationUat",
      (artifact: Record<string, unknown>) => {
        artifact.requestIds = Array.from({ length: 12 }, () => "reused-request-id");
      },
      /booking UAT evidence request IDs must be unique/i,
    ],
    [
      "bookingMutationUat",
      (artifact: Record<string, unknown>) => {
        artifact.preExistingActiveReservationsPreserved = false;
      },
      /booking UAT preExistingActiveReservationsPreserved must be true/i,
    ],
    [
      "bookingMutationUat",
      (artifact: Record<string, unknown>) => {
        artifact.lessonIdSha256 = "not-a-digest";
      },
      /booking UAT lessonIdSha256 must be a 16-character lowercase SHA-256 prefix/i,
    ],
    [
      "rollback",
      (artifact: Record<string, unknown>) => {
        delete artifact.requestIds;
      },
      /rollback requestIds must be an array/i,
    ],
    [
      "dnsRollbackBaseline",
      (artifact: Record<string, unknown>) => {
        artifact.recordSetSha256 = "b".repeat(64);
      },
      /record-set SHA-256 does not match/i,
    ],
    [
      "alertDelivery",
      (artifact: Record<string, unknown>) => {
        artifact.supportOwnerConfigured = false;
      },
      /alert supportOwnerConfigured must be true/i,
    ],
  ] as const) {
    const fixture = validFixture();
    const artifact = structuredClone(fixture.files[artifactName]) as Record<string, unknown>;
    mutate(artifact);
    const artifactSha = writeJson(join(fixture.directory, `${artifactName}.json`), artifact);
    const dossier = structuredClone(fixture.dossier);
    dossier.artifacts[artifactName].sha256 = artifactSha;
    const dossierSha = writeJson(fixture.dossierPath, dossier);
    assert.throws(
      () => verifyPilotReleaseEvidence({
        ...fixture.environment,
        ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION: `VERIFY_ZONE4YOU_RELEASE_DOSSIER:${dossierSha}`,
      }, now),
      expectedError,
    );
  }
});

test("pilot release dossier binds both feeds to the same seven Prague calendar days", () => {
  for (const [artifactName, mutate, expectedError] of [
    [
      "luxartReadOnly",
      (artifact: Record<string, unknown>) => {
        (artifact.range as Record<string, unknown>).to = "2026-09-13T00:00:00.000Z";
      },
      /luxartReadOnly\.range\.to must exactly equal/i,
    ],
    [
      "runtimeProbe",
      (artifact: Record<string, unknown>) => {
        const checks = artifact.checks as { lessons: { english: Record<string, unknown> } };
        checks.lessons.english.latestStartsAt = "2026-09-12T08:00:00.000Z";
        checks.lessons.english.dateKeys = ["2026-09-05", "2026-09-12"];
      },
      /outside the approved seven-day Prague range/i,
    ],
  ] as const) {
    const fixture = validFixture();
    const artifact = structuredClone(fixture.files[artifactName]) as Record<string, unknown>;
    mutate(artifact);
    const artifactSha = writeJson(join(fixture.directory, `${artifactName}.json`), artifact);
    const dossier = structuredClone(fixture.dossier);
    dossier.artifacts[artifactName].sha256 = artifactSha;
    const dossierSha = writeJson(fixture.dossierPath, dossier);
    assert.throws(
      () => verifyPilotReleaseEvidence({
        ...fixture.environment,
        ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION: `VERIFY_ZONE4YOU_RELEASE_DOSSIER:${dossierSha}`,
      }, now),
      expectedError,
    );
  }
});

test("pilot release dossier rejects an observed hall without a reservation resource mapping", () => {
  const fixture = validFixture();
  assert.throws(
    () => verifyPilotReleaseEvidence({ ...fixture.environment, LUXART_RESOURCE_MAP_JSON: JSON.stringify({ 1: 101, 2: 102 }) }, now),
    /missing observed room numbers: 3/i,
  );
});

test("pilot release dossier rejects malformed resource-map entries instead of silently dropping them", () => {
  for (const mapping of [
    JSON.stringify({ 1: 101, 2: 102, 3: 203, broken: 999 }),
    JSON.stringify({ 1: 101, 2: 102, 3: 203, "04": 204 }),
    JSON.stringify({ 1: 101, 2: 102, 3: 203, 4: 0 }),
  ]) {
    const fixture = validFixture();
    assert.throws(
      () => verifyPilotReleaseEvidence({ ...fixture.environment, LUXART_RESOURCE_MAP_JSON: mapping }, now),
      /LUXART_RESOURCE_MAP_JSON must map positive room numbers/i,
    );
  }
});

test("pilot release dossier binds the live Luxart evidence to the confirmed gateway auth mode", () => {
  const fixture = validFixture();
  assert.throws(
    () => verifyPilotReleaseEvidence({
      ...fixture.environment,
      LUXART_API_AUTH_MODE: "basic",
      LUXART_API_BASIC_USERNAME: "gateway-user",
      LUXART_API_BASIC_PASSWORD: "gateway-password",
    }, now),
    /gatewayAuthMode must exactly equal basic/i,
  );
});

test("pilot release dossier binds runtime readiness to the configured rate-limit mode", () => {
  const fixture = validFixture();
  assert.throws(
    () => verifyPilotReleaseEvidence({
      ...fixture.environment,
      RATE_LIMIT_MODE: "postgres",
      RATE_LIMIT_DATABASE_URL: "postgresql://booking.example.com/zone4you?sslmode=require",
    }, now),
    /readiness\.rateLimit must exactly equal postgres/i,
  );
});

test("pilot release dossier binds runtime readiness to the exact release commit and launch phase", () => {
  for (const [field, value, expectedError] of [
    ["commit", "b".repeat(40), /runtime readiness\.commit must exactly equal/i],
    ["phase", "booking_with_stripe", /runtime readiness\.phase must exactly equal booking_without_payments/i],
    ["region", "iad1", /runtime readiness\.region must exactly equal fra1/i],
    ["schedule", "empty", /runtime readiness\.schedule must exactly equal ready/i],
  ] as const) {
    const fixture = validFixture();
    const runtime = structuredClone(fixture.files.runtimeProbe) as {
      checks: { readiness: Record<string, unknown> };
    };
    runtime.checks.readiness[field] = value;
    const runtimePath = join(fixture.directory, "runtimeProbe.json");
    const runtimeSha = writeJson(runtimePath, runtime);
    const dossier = structuredClone(fixture.dossier);
    dossier.artifacts.runtimeProbe.sha256 = runtimeSha;
    const dossierSha = writeJson(fixture.dossierPath, dossier);
    assert.throws(
      () => verifyPilotReleaseEvidence({
        ...fixture.environment,
        ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION: `VERIFY_ZONE4YOU_RELEASE_DOSSIER:${dossierSha}`,
      }, now),
      expectedError,
    );
  }
});

test("pilot release dossier binds runtime capabilities to the limited no-payment pilot", () => {
  for (const [field, value, expectedError] of [
    ["payments", "ready", /runtime readiness\.payments must exactly equal disabled/i],
    ["capabilities.topupsEnabled", true, /runtime topupsEnabled must be false/i],
    ["capabilities.waitlistEnabled", true, /runtime waitlistEnabled must be false/i],
    ["capabilities.englishEnabled", false, /runtime englishEnabled must be true/i],
    ["capabilities.favoritesSync", "none", /runtime favoritesSync must exactly equal device/i],
    ["lessons.english.occurrenceSetSha256", "b".repeat(64), /runtime English lesson occurrence digest/i],
  ] as const) {
    const fixture = validFixture();
    const runtime = structuredClone(fixture.files.runtimeProbe) as {
      checks: { readiness: Record<string, unknown> & { capabilities: Record<string, unknown> } };
    };
    if (field.startsWith("capabilities.")) {
      runtime.checks.readiness.capabilities[field.slice("capabilities.".length)] = value;
    } else if (field === "lessons.english.occurrenceSetSha256") {
      const lessons = runtime.checks as unknown as {
        lessons: { english: Record<string, unknown> };
      };
      lessons.lessons.english.occurrenceSetSha256 = value;
    } else {
      runtime.checks.readiness[field] = value;
    }
    const runtimeSha = writeJson(join(fixture.directory, "runtimeProbe.json"), runtime);
    const dossier = structuredClone(fixture.dossier);
    dossier.artifacts.runtimeProbe.sha256 = runtimeSha;
    const dossierSha = writeJson(fixture.dossierPath, dossier);
    assert.throws(
      () => verifyPilotReleaseEvidence({
        ...fixture.environment,
        ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION: `VERIFY_ZONE4YOU_RELEASE_DOSSIER:${dossierSha}`,
      }, now),
      expectedError,
    );
  }
});

test("pilot release dossier rejects modified evidence even when its JSON still says ok", () => {
  const fixture = validFixture();
  const runtimePath = join(fixture.directory, "runtimeProbe.json");
  writeJson(runtimePath, { ...fixture.files.runtimeProbe as object, extra: "tampered" });
  assert.throws(() => verifyPilotReleaseEvidence(fixture.environment, now), /SHA-256 does not match/i);
});

test("pilot release dossier rejects stale evidence and missing live approval", () => {
  const fixture = validFixture();
  assert.throws(
    () => verifyPilotReleaseEvidence(fixture.environment, new Date("2026-09-05T13:00:00.000Z")),
    /approved launch window/i,
  );

  const dossier = structuredClone(fixture.dossier);
  dossier.approvals.cutover.approved = false;
  const dossierSha = writeJson(fixture.dossierPath, dossier);
  assert.throws(
    () => verifyPilotReleaseEvidence({
      ...fixture.environment,
      ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION: `VERIFY_ZONE4YOU_RELEASE_DOSSIER:${dossierSha}`,
    }, now),
    /cutover\.approved must be true/i,
  );
});

test("pilot release dossier never treats a prepared draft as cutover authority", () => {
  const fixture = validFixture();
  const dossier = structuredClone(fixture.dossier);
  dossier.draft = true;
  const dossierSha = writeJson(fixture.dossierPath, dossier);
  assert.throws(
    () => verifyPilotReleaseEvidence({
      ...fixture.environment,
      ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION: `VERIFY_ZONE4YOU_RELEASE_DOSSIER:${dossierSha}`,
    }, now),
    /release dossier draft must be false/i,
  );
});

test("Stripe launch mode cannot pass without its own end-to-end UAT artifact", () => {
  const fixture = validFixture();
  const runtime = structuredClone(fixture.files.runtimeProbe) as {
    checks: { readiness: Record<string, unknown> };
  };
  runtime.checks.readiness.phase = "booking_with_stripe";
  runtime.checks.readiness.payments = "ready";
  const capabilities = runtime.checks.readiness.capabilities as Record<string, unknown>;
  capabilities.topupsEnabled = true;
  capabilities.topupMode = "stripe";
  const runtimeSha = writeJson(join(fixture.directory, "runtimeProbe.json"), runtime);
  const bookingMutationUat = structuredClone(fixture.files.bookingMutationUat) as Record<string, unknown>;
  bookingMutationUat.phase = "booking_with_stripe";
  const bookingMutationUatSha = writeJson(
    join(fixture.directory, "bookingMutationUat.json"),
    bookingMutationUat,
  );
  const dossier = structuredClone(fixture.dossier);
  dossier.launchMode = "booking_with_stripe";
  dossier.artifacts.runtimeProbe.sha256 = runtimeSha;
  dossier.artifacts.bookingMutationUat.sha256 = bookingMutationUatSha;
  const dossierSha = writeJson(fixture.dossierPath, dossier);
  assert.throws(
    () => verifyPilotReleaseEvidence({
      ...fixture.environment,
      ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION: `VERIFY_ZONE4YOU_RELEASE_DOSSIER:${dossierSha}`,
    }, now),
    /artifacts\.stripeUat/i,
  );
});
