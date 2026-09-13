import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyPilotReleaseEvidence } from "../scripts/verify-pilot-release";
import {
  approvedLuxartReferenceSemanticContractSha256,
  luxartPublicContractEndpoints,
} from "../scripts/verify-luxart-public-contract";
import { memberzoneFallbackUrl } from "../scripts/verify-memberzone-fallback";
import { luxartResourceMappingSha256 } from "../src/lib/luxartResourceMappingFingerprint";
import { maximumOperationalAmountKc } from "../src/lib/moneyBounds";

const now = new Date("2026-09-05T08:00:00.000Z");
const commit = "1234567890abcdef1234567890abcdef12345678";
const stagingTarget = "https://staging.booking.zone4you.cz";
const luxartTarget = "https://luxart-test.example.com:9443";
const luxartTargetFingerprint = createHash("sha256").update(luxartTarget).digest("hex");
const occurrenceSetSha256 = "a".repeat(64);
const roomPlacementSetSha256 = "b".repeat(64);
const czechLessonContentSetSha256 = "c".repeat(64);
const englishLessonContentSetSha256 = "d".repeat(64);
const resourceMapJson = JSON.stringify({ 1: 101, 2: 102, 3: 203 });
const resourceMapSha256 = luxartResourceMappingSha256(resourceMapJson);

function writeJson(path: string, value: unknown) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, body, "utf8");
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function bookingUatScenario(
  lessonKind: "standard" | "reformer",
  checkedAt: string,
  lessonRoomNumber: number,
  lessonIdSha256: string,
  reservationIdSha256: string,
  requestPrefix: string,
) {
  return {
    schemaVersion: 1,
    ok: true,
    checkedAt,
    target: stagingTarget,
    deploymentProvenanceVerified: true,
    commit,
    phase: "booking_without_payments",
    region: "fra1",
    lessonKind,
    userVerified: true,
    personalizedEligibilityVerified: true,
    authoritativeAvailabilityVerified: true,
    reservationWindowVerified: true,
    onlineCancellationVerified: true,
    resourceMapSha256,
    lessonRoomNumber,
    lessonIdSha256,
    reservationIdSha256,
    expectedCancellationFeeKc: 0,
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
    requestIds: Array.from({ length: 16 }, (_, index) => `${requestPrefix}-${index}`),
  };
}

function mutableBookingUatScenario(
  artifact: Record<string, unknown>,
  lessonKind: "standard" | "reformer" = "standard",
) {
  const scenarios = artifact.scenarios as Record<string, Record<string, unknown>>;
  return scenarios[lessonKind];
}

function validFixture() {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-release-evidence-"));
  const checkedAt = "2026-09-05T07:30:00.000Z";
  const rollbackDrillId = "22c0bf77-6a42-4e9d-827d-a5ec8c6f3a0a";
  const rollbackTimer = {
    schemaVersion: 1,
    ok: true,
    checkedAt: "2026-09-05T07:29:46.000Z",
    startedAt: "2026-09-05T07:29:46.000Z",
    target: stagingTarget,
    commit,
    maximumDurationMs: 300_000,
    drillId: rollbackDrillId,
  };
  const rollbackTimerBody = `${JSON.stringify(rollbackTimer, null, 2)}\n`;
  const rollbackTimerSha256 = createHash("sha256").update(rollbackTimerBody).digest("hex");
  const files: Record<string, unknown> = {
    luxartReadOnly: {
      ok: true,
      checkedAt,
      target: luxartTarget,
      apiContract: "memberzone_rest_v1",
      gatewayAuthMode: "none",
      d1: {
        schemaVersion: 3,
        checkedAt,
        targetFingerprintSha256: luxartTargetFingerprint,
        helpClassification: "ready",
        helpTransport: "https",
        helpPort: "9443",
        helpHttpStatus: 200,
        helpBodySha256: "b".repeat(64),
        gatewayAuthMode: "none",
        apiContract: "memberzone_rest_v1",
        contractCheckedAt: checkedAt,
        contractEndpointCount: luxartPublicContractEndpoints.length,
        contractSemanticSha256: approvedLuxartReferenceSemanticContractSha256,
        contractBaselineVerified: true,
        approvedOriginFingerprintVerified: true,
        authenticatedReadOnlyVerified: true,
        personalizedLessonSetVerified: true,
      },
      range: {
        from: "2026-09-05T00:00:00.000Z",
        to: "2026-09-12T00:00:00.000Z",
        days: 7,
        timeZone: "Europe/Prague",
      },
      czech: {
        count: 24,
        occurrenceSetSha256,
        roomPlacementSetSha256,
        lessonContentSetSha256: czechLessonContentSetSha256,
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
        roomPlacementSetSha256,
        lessonContentSetSha256: englishLessonContentSetSha256,
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
        czech: {
          count: 24,
          occurrenceSetSha256,
          roomPlacementSetSha256,
          lessonContentSetSha256: czechLessonContentSetSha256,
          eligible: 22,
          ineligible: 2,
        },
        english: {
          count: 24,
          occurrenceSetSha256,
          roomPlacementSetSha256,
          lessonContentSetSha256: englishLessonContentSetSha256,
          eligible: 22,
          ineligible: 2,
        },
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
          bookingNotifications: "ready",
          resourceMapSha256,
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
            roomPlacementSetSha256,
            lessonContentSetSha256: czechLessonContentSetSha256,
            roomNumbers: [1, 2, 3],
            reformer: 3,
            earliestStartsAt: "2026-09-05T08:00:00.000Z",
            latestStartsAt: "2026-09-11T18:00:00.000Z",
            dateKeys: ["2026-09-05", "2026-09-11"],
          },
          english: {
            ok: true,
            count: 24,
            occurrenceSetSha256,
            roomPlacementSetSha256,
            lessonContentSetSha256: englishLessonContentSetSha256,
            roomNumbers: [1, 2, 3],
            reformer: 3,
            earliestStartsAt: "2026-09-05T08:00:00.000Z",
            latestStartsAt: "2026-09-11T18:00:00.000Z",
            dateKeys: ["2026-09-05", "2026-09-11"],
          },
        },
      },
    },
    bookingMutationUat: {
      schemaVersion: 2,
      ok: true,
      checkedAt,
      target: stagingTarget,
      deploymentProvenanceVerified: true,
      commit,
      phase: "booking_without_payments",
      region: "fra1",
      scenarioCount: 2,
      scenarios: {
        standard: bookingUatScenario("standard", checkedAt, 1, "c".repeat(16), "d".repeat(16), "standard-request"),
        reformer: bookingUatScenario("reformer", checkedAt, 3, "e".repeat(16), "f".repeat(16), "reformer-request"),
      },
    },
    rollbackTimer,
    rollback: {
      schemaVersion: 2,
      ok: true,
      checkedAt,
      rollbackStartedAt: "2026-09-05T07:29:46.000Z",
      rollbackDrillId,
      rollbackTimerSha256,
      readOnlyVerifiedAt: checkedAt,
      target: stagingTarget,
      commit,
      phase: "read_only",
      region: "fra1",
      recoveryDurationMs: 14_000,
      verificationDurationMs: 7_000,
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
    memberzoneFallback: {
      schemaVersion: 1,
      ok: true,
      checkedAt,
      target: memberzoneFallbackUrl.href,
      targetFingerprintSha256: createHash("sha256").update(memberzoneFallbackUrl.href).digest("hex"),
      transport: "https",
      httpStatus: 200,
      contentType: "text/html",
      bodyBytes: 153_976,
      bodySha256: "e".repeat(64),
      schedulerDetected: true,
      signInPathDetected: true,
      nonEmptyScheduleDetected: true,
      reformerDetected: true,
    },
  };

  const artifacts = Object.fromEntries(
    Object.entries(files).map(([name, value]) => {
      const path = join(directory, `${name}.json`);
      return [name, { path, sha256: writeJson(path, value) }];
    }),
  );
  chmodSync(artifacts.dnsRollbackBaseline.path, 0o600);
  chmodSync(artifacts.memberzoneFallback.path, 0o600);
  chmodSync(artifacts.rollbackTimer.path, 0o600);
  const dossier = {
    schemaVersion: 6,
    draft: false,
    releaseId: "zone4you-pilot-2026-09-05",
    target: "https://booking.zone4you.cz/",
    stagingTarget: `${stagingTarget}/`,
    luxartOrigin: `${luxartTarget}/`,
    luxartApiContract: "memberzone_rest_v1",
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
      luxartNotifications: {
        confirmed: true,
        approvedBy: "Luxart integration owner",
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
  chmodSync(dossierPath, 0o600);
  const environment = {
    ZONE4YOU_RELEASE_DOSSIER_PATH: dossierPath,
    ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION: `VERIFY_ZONE4YOU_RELEASE_DOSSIER:${dossierSha}`,
    ZONE4YOU_RELEASE_COMMIT: commit,
    LUXART_RESOURCE_MAP_JSON: resourceMapJson,
    LUXART_API_CONTRACT: "memberzone_rest_v1",
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
  assert.equal(result.conditions.luxartNotificationTemplatesConfirmed, true);
  assert.equal(result.conditions.explicitCutoverApproval, true);
  assert.equal(result.cutoverApprovedAt, "2026-09-05T07:50:00.000Z");
  assert.deepEqual(result.lessonFeed, {
    count: 24,
    occurrenceSetSha256,
    roomPlacementSetSha256,
    localizedContentSha256: {
      czech: czechLessonContentSetSha256,
      english: englishLessonContentSetSha256,
    },
    resourceMapSha256,
    roomNumbers: [1, 2, 3],
    reformer: 3,
    range: {
      from: "2026-09-05T00:00:00.000Z",
      to: "2026-09-12T00:00:00.000Z",
      days: 7,
      timeZone: "Europe/Prague",
    },
    earliestStartsAt: "2026-09-05T08:00:00.000Z",
    latestStartsAt: "2026-09-11T18:00:00.000Z",
    dateKeys: ["2026-09-05", "2026-09-11"],
  });
  assert.equal(result.paymentsIncluded, false);
  assert.equal(result.artifacts.length, 8);
  assert.equal(JSON.stringify(result).includes("approvedBy"), false);
  assert.equal(JSON.stringify(result).includes(fixture.dossierPath), false);
  chmodSync(fixture.dossier.artifacts.dnsRollbackBaseline.path, 0o644);
  assert.throws(
    () => verifyPilotReleaseEvidence(fixture.environment, now),
    /dnsRollbackBaseline must not be accessible/i,
  );

  const readableFallback = validFixture();
  chmodSync(readableFallback.dossier.artifacts.memberzoneFallback.path, 0o640);
  assert.throws(
    () => verifyPilotReleaseEvidence(readableFallback.environment, now),
    /memberzoneFallback must not be accessible/i,
  );

  const readableRollbackTimer = validFixture();
  chmodSync(readableRollbackTimer.dossier.artifacts.rollbackTimer.path, 0o640);
  assert.throws(
    () => verifyPilotReleaseEvidence(readableRollbackTimer.environment, now),
    /rollbackTimer must not be accessible/i,
  );
});

test("pilot release dossier refuses writable or symlinked release evidence", () => {
  const writableArtifact = validFixture();
  chmodSync(writableArtifact.dossier.artifacts.runtimeProbe.path, 0o660);
  assert.throws(
    () => verifyPilotReleaseEvidence(writableArtifact.environment, now),
    /runtimeProbe must not be writable by group or other users/i,
  );

  const writableDossier = validFixture();
  chmodSync(writableDossier.dossierPath, 0o660);
  assert.throws(
    () => verifyPilotReleaseEvidence(writableDossier.environment, now),
    /release dossier must not be accessible by group or other users/i,
  );

  const readableDossier = validFixture();
  chmodSync(readableDossier.dossierPath, 0o640);
  assert.throws(
    () => verifyPilotReleaseEvidence(readableDossier.environment, now),
    /release dossier must not be accessible by group or other users/i,
  );

  const symlinkedArtifact = validFixture();
  const runtimeLink = join(symlinkedArtifact.directory, "runtime-link.json");
  symlinkSync(symlinkedArtifact.dossier.artifacts.runtimeProbe.path, runtimeLink);
  const dossier = structuredClone(symlinkedArtifact.dossier);
  dossier.artifacts.runtimeProbe.path = runtimeLink;
  const dossierSha = writeJson(symlinkedArtifact.dossierPath, dossier);
  assert.throws(
    () => verifyPilotReleaseEvidence({
      ...symlinkedArtifact.environment,
      ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION: `VERIFY_ZONE4YOU_RELEASE_DOSSIER:${dossierSha}`,
    }, now),
    /runtimeProbe must be an existing regular file, not a symlink/i,
  );
});

test("pilot release dossier rejects evidence that cannot come from the real guarded producers", () => {
  for (const [artifactName, mutate, expectedError] of [
    [
      "luxartReadOnly",
      (artifact: Record<string, unknown>) => {
        delete artifact.d1;
      },
      /luxartReadOnly\.d1 must be a JSON object/i,
    ],
    [
      "luxartReadOnly",
      (artifact: Record<string, unknown>) => {
        (artifact.d1 as Record<string, unknown>).targetFingerprintSha256 = "c".repeat(64);
      },
      /D1 targetFingerprintSha256 must exactly equal/i,
    ],
    [
      "luxartReadOnly",
      (artifact: Record<string, unknown>) => {
        (artifact.d1 as Record<string, unknown>).contractSemanticSha256 = "c".repeat(64);
      },
      /D1 contractSemanticSha256 must exactly equal/i,
    ],
    [
      "luxartReadOnly",
      (artifact: Record<string, unknown>) => {
        (artifact.d1 as Record<string, unknown>).contractEndpointCount = 10;
      },
      /D1 contractEndpointCount must be 11/i,
    ],
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
        artifact.schemaVersion = 1;
      },
      /Booking UAT evidence schemaVersion must be 2/i,
    ],
    [
      "bookingMutationUat",
      (artifact: Record<string, unknown>) => {
        artifact.ok = false;
      },
      /bookingMutationUat\.ok must be true/i,
    ],
    [
      "bookingMutationUat",
      (artifact: Record<string, unknown>) => {
        delete (artifact.scenarios as Record<string, unknown>).reformer;
      },
      /scenarios must contain exactly standard and reformer evidence/i,
    ],
    [
      "bookingMutationUat",
      (artifact: Record<string, unknown>) => {
        mutableBookingUatScenario(artifact, "reformer").lessonKind = "standard";
      },
      /booking UAT reformer lessonKind must exactly equal reformer/i,
    ],
    [
      "bookingMutationUat",
      (artifact: Record<string, unknown>) => {
        mutableBookingUatScenario(artifact).expectedCancellationFeeKc = maximumOperationalAmountKc + 1;
      },
      /booking UAT standard expectedCancellationFeeKc must not exceed/i,
    ],
    [
      "bookingMutationUat",
      (artifact: Record<string, unknown>) => {
        mutableBookingUatScenario(artifact).authoritativeAvailabilityVerified = false;
      },
      /booking UAT standard authoritativeAvailabilityVerified must be true/i,
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
        mutableBookingUatScenario(artifact).resourceMapSha256 = "f".repeat(64);
      },
      /booking UAT standard resourceMapSha256 must exactly equal/i,
    ],
    [
      "bookingMutationUat",
      (artifact: Record<string, unknown>) => {
        mutableBookingUatScenario(artifact).requestIds = Array.from({ length: 16 }, () => "reused-request-id");
      },
      /booking UAT standard evidence request IDs must be unique/i,
    ],
    [
      "bookingMutationUat",
      (artifact: Record<string, unknown>) => {
        mutableBookingUatScenario(artifact, "reformer").requestIds = mutableBookingUatScenario(artifact).requestIds;
      },
      /request IDs must be unique across both scenarios/i,
    ],
    [
      "bookingMutationUat",
      (artifact: Record<string, unknown>) => {
        mutableBookingUatScenario(artifact).preExistingActiveReservationsPreserved = false;
      },
      /booking UAT standard preExistingActiveReservationsPreserved must be true/i,
    ],
    [
      "bookingMutationUat",
      (artifact: Record<string, unknown>) => {
        mutableBookingUatScenario(artifact).lessonIdSha256 = "not-a-digest";
      },
      /booking UAT standard lessonIdSha256 must be a 16-character lowercase SHA-256 prefix/i,
    ],
    [
      "bookingMutationUat",
      (artifact: Record<string, unknown>) => {
        mutableBookingUatScenario(artifact, "reformer").lessonIdSha256 = mutableBookingUatScenario(artifact).lessonIdSha256;
      },
      /must use different lesson occurrences/i,
    ],
    [
      "rollbackTimer",
      (artifact: Record<string, unknown>) => {
        artifact.drillId = "6182a4d0-d12f-4012-894f-2050f8a56857";
      },
      /rollback drillId must exactly equal/i,
    ],
    [
      "rollback",
      (artifact: Record<string, unknown>) => {
        delete artifact.requestIds;
      },
      /rollback requestIds must be an array/i,
    ],
    [
      "rollback",
      (artifact: Record<string, unknown>) => {
        artifact.recoveryDurationMs = 1;
      },
      /recoveryDurationMs does not match/i,
    ],
    [
      "rollback",
      (artifact: Record<string, unknown>) => {
        artifact.commit = "f".repeat(40);
      },
      /rollback commit must exactly equal/i,
    ],
    [
      "rollback",
      (artifact: Record<string, unknown>) => {
        artifact.rollbackTimerSha256 = "f".repeat(64);
      },
      /rollback timer SHA-256 must exactly equal/i,
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
    [
      "memberzoneFallback",
      (artifact: Record<string, unknown>) => {
        artifact.target = "https://memberzone.cz/zone4you/";
      },
      /Memberzone fallback target must exactly equal/i,
    ],
    [
      "memberzoneFallback",
      (artifact: Record<string, unknown>) => {
        artifact.nonEmptyScheduleDetected = false;
      },
      /Memberzone fallback nonEmptyScheduleDetected must be true/i,
    ],
    [
      "memberzoneFallback",
      (artifact: Record<string, unknown>) => {
        artifact.bodySha256 = "not-a-digest";
      },
      /Memberzone fallback bodySha256 must be a full lowercase SHA-256 digest/i,
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

test("pilot release dossier binds every lesson to the same Luxart room in live and runtime evidence", () => {
  for (const [artifactName, mutate, expectedError] of [
    [
      "luxartReadOnly",
      (artifact: Record<string, unknown>) => {
        const english = artifact.english as Record<string, unknown>;
        english.roomPlacementSetSha256 = "e".repeat(64);
      },
      /Luxart room-placement digests must be the same/i,
    ],
    [
      "runtimeProbe",
      (artifact: Record<string, unknown>) => {
        const checks = artifact.checks as { lessons: { english: Record<string, unknown> } };
        checks.lessons.english.roomPlacementSetSha256 = "e".repeat(64);
      },
      /runtime English lesson room-placement digest/i,
    ],
    [
      "runtimeProbe",
      (artifact: Record<string, unknown>) => {
        const checks = artifact.checks as { lessons: { english: Record<string, unknown> } };
        checks.lessons.english.roomNumbers = [1, 2, 4];
      },
      /approved Luxart room-number set/i,
    ],
    [
      "luxartReadOnly",
      (artifact: Record<string, unknown>) => {
        const personalized = artifact.personalized as { english: Record<string, unknown> };
        personalized.english.lessonContentSetSha256 = "e".repeat(64);
      },
      /personalized English lesson-content digest/i,
    ],
    [
      "runtimeProbe",
      (artifact: Record<string, unknown>) => {
        const checks = artifact.checks as { lessons: { czech: Record<string, unknown> } };
        checks.lessons.czech.lessonContentSetSha256 = "e".repeat(64);
      },
      /runtime Czech lesson-content digest/i,
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

test("pilot release dossier binds runtime evidence to the implemented REST API contract", () => {
  const fixture = validFixture();
  const dossier = structuredClone(fixture.dossier);
  dossier.luxartApiContract = "soap_wcf";
  const dossierSha = writeJson(fixture.dossierPath, dossier);
  assert.throws(
    () => verifyPilotReleaseEvidence({
      ...fixture.environment,
      ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION: `VERIFY_ZONE4YOU_RELEASE_DOSSIER:${dossierSha}`,
    }, now),
    /luxartApiContract must exactly equal memberzone_rest_v1/i,
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
    ["bookingNotifications", "unconfirmed", /runtime readiness\.bookingNotifications must exactly equal ready/i],
    ["resourceMapSha256", "f".repeat(64), /runtime readiness\.resourceMapSha256 must exactly equal/i],
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

  const missingNotificationApproval = validFixture();
  const notificationDossier = structuredClone(missingNotificationApproval.dossier);
  notificationDossier.approvals.luxartNotifications.confirmed = false;
  const notificationDossierSha = writeJson(missingNotificationApproval.dossierPath, notificationDossier);
  assert.throws(
    () => verifyPilotReleaseEvidence({
      ...missingNotificationApproval.environment,
      ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION: `VERIFY_ZONE4YOU_RELEASE_DOSSIER:${notificationDossierSha}`,
    }, now),
    /luxartNotifications\.confirmed must be true/i,
  );
});

test("pilot release approvals cannot predate their evidence or the final cutover", () => {
  for (const [approvalName, approvedAtValue, expectedError] of [
    ["uat", "2026-09-05T07:29:00.000Z", /approvals\.uat\.approvedAt must not predate artifacts\.bookingMutationUat\.checkedAt/i],
    ["alertReceipt", "2026-09-05T07:29:00.000Z", /approvals\.alertReceipt\.approvedAt must not predate artifacts\.alertDelivery\.checkedAt/i],
    ["memberzoneFallback", "2026-09-05T07:29:00.000Z", /approvals\.memberzoneFallback\.approvedAt must not predate artifacts\.memberzoneFallback\.checkedAt/i],
    ["luxartNotifications", "2026-09-05T07:29:00.000Z", /approvals\.luxartNotifications\.approvedAt must not predate artifacts\.runtimeProbe\.checkedAt/i],
    ["cutover", "2026-09-05T07:39:00.000Z", /approvals\.cutover\.approvedAt must not predate approvals\.uat\.approvedAt/i],
  ] as const) {
    const fixture = validFixture();
    const dossier = structuredClone(fixture.dossier);
    dossier.approvals[approvalName].approvedAt = approvedAtValue;
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

test("pilot release approvals reject placeholder and unsafe approver identities", () => {
  for (const approvedBy of [
    "TBD",
    "unknown",
    "N/A",
    "pending-human-approval",
    "replace-with-authorized-role",
    "replace-with-support-owner",
    "replace-with-luxart-or-zone4you-owner",
    "replace-with-authorized-release-owner",
    "Release\u0000owner",
  ]) {
    const fixture = validFixture();
    const dossier = structuredClone(fixture.dossier);
    dossier.approvals.cutover.approvedBy = approvedBy;
    const dossierSha = writeJson(fixture.dossierPath, dossier);
    assert.throws(
      () => verifyPilotReleaseEvidence({
        ...fixture.environment,
        ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION: `VERIFY_ZONE4YOU_RELEASE_DOSSIER:${dossierSha}`,
      }, now),
      /actual approving person or operational role|control characters/i,
    );
  }
});

test("pilot release cutover cannot predate the latest artifact", () => {
  const fixture = validFixture();
  const rollbackTimer = structuredClone(fixture.files.rollbackTimer) as Record<string, unknown>;
  rollbackTimer.checkedAt = "2026-09-05T07:49:46.000Z";
  rollbackTimer.startedAt = "2026-09-05T07:49:46.000Z";
  const rollback = structuredClone(fixture.files.rollback) as Record<string, unknown>;
  rollback.checkedAt = "2026-09-05T07:50:30.000Z";
  rollback.readOnlyVerifiedAt = "2026-09-05T07:50:30.000Z";
  rollback.rollbackStartedAt = "2026-09-05T07:49:46.000Z";
  rollback.recoveryDurationMs = 44_000;
  const dossier = structuredClone(fixture.dossier);
  dossier.artifacts.rollbackTimer.sha256 = writeJson(dossier.artifacts.rollbackTimer.path, rollbackTimer);
  chmodSync(dossier.artifacts.rollbackTimer.path, 0o600);
  rollback.rollbackTimerSha256 = dossier.artifacts.rollbackTimer.sha256;
  dossier.artifacts.rollback.sha256 = writeJson(dossier.artifacts.rollback.path, rollback);
  const dossierSha = writeJson(fixture.dossierPath, dossier);

  assert.throws(
    () => verifyPilotReleaseEvidence({
      ...fixture.environment,
      ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION: `VERIFY_ZONE4YOU_RELEASE_DOSSIER:${dossierSha}`,
    }, now),
    /approvals\.cutover\.approvedAt must not predate artifacts\.rollback\.checkedAt/i,
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
  mutableBookingUatScenario(bookingMutationUat).phase = "booking_with_stripe";
  mutableBookingUatScenario(bookingMutationUat, "reformer").phase = "booking_with_stripe";
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
