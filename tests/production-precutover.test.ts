import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  verifyProductionPreCutover,
  writeProductionPreCutoverEvidence,
} from "../scripts/verify-production-precutover";

const now = new Date("2026-09-11T14:00:00.000Z");
const dossierSha256 = "a".repeat(64);
const baselineSha256 = "b".repeat(64);
const environment = {
  ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION: `VERIFY_ZONE4YOU_RELEASE_DOSSIER:${dossierSha256}`,
  ZONE4YOU_PRECUTOVER_CONFIRMATION: `VERIFY_ZONE4YOU_PRECUTOVER:${dossierSha256}`,
  ZONE4YOU_DNS_BASELINE_EVIDENCE_PATH: "/secure/production-dns-baseline.json",
};

function releaseEvidence(cutoverApprovedAt = now.toISOString()) {
  return {
    ok: true as const,
    checkedAt: now.toISOString(),
    cutoverApprovedAt,
    dossierFingerprint: dossierSha256.slice(0, 16),
    releaseId: "zone4you-pilot-2026-09-11",
    target: "https://booking.zone4you.cz",
    stagingTarget: "https://staging.booking.zone4you.cz",
    commit: "1".repeat(40),
    launchMode: "booking_without_payments",
    paymentsIncluded: false,
    lessonFeed: {
      count: 24,
      occurrenceSetSha256: "c".repeat(64),
      reformer: 3,
      range: {
        from: "2026-09-11T00:00:00.000Z",
        to: "2026-09-18T00:00:00.000Z",
        days: 7 as const,
        timeZone: "Europe/Prague" as const,
      },
      earliestStartsAt: "2026-09-11T08:00:00.000Z",
      latestStartsAt: "2026-09-17T18:00:00.000Z",
      dateKeys: ["2026-09-11", "2026-09-17"],
    },
    conditions: {
      liveLuxartVerified: true,
      allObservedRoomsMapped: true,
      fullLessonFeedMatched: true,
      personalizedEligibilityVerified: true,
      exactSevenDayPragueRangeVerified: true,
      bookingMutationUatPassed: true,
      rollbackUnderFiveMinutes: true,
      dnsRollbackBaselineReady: true,
      alertReceiptConfirmed: true,
      noOpenP0P1: true,
      memberzoneFallbackAvailable: true,
      luxartNotificationTemplatesConfirmed: true,
      explicitCutoverApproval: true,
    },
    artifacts: [
      { name: "dnsRollbackBaseline", sha256: baselineSha256 },
    ],
  };
}

function dnsEvidence(fileSha256 = baselineSha256) {
  return {
    ok: true,
    checkedAt: now.toISOString(),
    hostname: "booking.zone4you.cz",
    baselineCheckedAt: now.toISOString(),
    recordCount: 2,
    recordTypes: ["A", "AAAA"] as Array<"A" | "AAAA" | "CNAME">,
    recordSetSha256: "c".repeat(64),
    baselineFileSha256: fileSha256,
    unchangedSinceCapture: true,
    rollbackReady: true,
  };
}

test("pre-cutover gate binds the approved dossier to the unchanged live DNS rollback baseline", async () => {
  let receivedDnsConfirmation = "";
  const result = await verifyProductionPreCutover({
    environment,
    now,
    releaseVerifier: () => releaseEvidence(),
    dnsVerifier: async ({ environment: dnsEnvironment }) => {
      receivedDnsConfirmation = dnsEnvironment.ZONE4YOU_DNS_BASELINE_VERIFY_CONFIRMATION ?? "";
      return dnsEvidence();
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.decision, "GO_TO_AUTHORIZED_DNS_CHANGE");
  assert.equal(result.explicitCutoverApproval, true);
  assert.equal(result.cutoverApprovedAt, now.toISOString());
  assert.equal(result.lessonFeed.occurrenceSetSha256, "c".repeat(64));
  assert.equal(result.lessonFeed.count, 24);
  assert.equal(receivedDnsConfirmation, `VERIFY_ZONE4YOU_DNS_BASELINE:${baselineSha256}`);
});

test("pre-cutover gate requires its own confirmation bound to the full dossier digest", async () => {
  await assert.rejects(
    verifyProductionPreCutover({
      environment: { ...environment, ZONE4YOU_PRECUTOVER_CONFIRMATION: "YES" },
      now,
      releaseVerifier: () => releaseEvidence(),
      dnsVerifier: async () => dnsEvidence(),
    }),
    /must exactly equal/i,
  );
});

test("pre-cutover gate cannot run before the recorded final approval", async () => {
  await assert.rejects(
    verifyProductionPreCutover({
      environment,
      now,
      releaseVerifier: () => releaseEvidence(new Date(now.getTime() + 60_000).toISOString()),
      dnsVerifier: async () => dnsEvidence(),
    }),
    /must not predate the final cutover approval/i,
  );
});

test("pre-cutover gate fails when release approval or DNS baseline binding is absent", async () => {
  const unapproved = releaseEvidence();
  unapproved.conditions.explicitCutoverApproval = false;
  await assert.rejects(
    verifyProductionPreCutover({
      environment,
      now,
      releaseVerifier: () => unapproved,
      dnsVerifier: async () => dnsEvidence(),
    }),
    /does not authorize/i,
  );

  await assert.rejects(
    verifyProductionPreCutover({
      environment,
      now,
      releaseVerifier: () => releaseEvidence(),
      dnsVerifier: async () => dnsEvidence("d".repeat(64)),
    }),
    /does not match the approved rollback baseline/i,
  );
});

test("pre-cutover gate stores one owner-only receipt outside the repository and never overwrites it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-precutover-"));
  chmodSync(directory, 0o700);
  const outputPath = join(directory, "precutover.json");
  const outputEnvironment = {
    ...environment,
    ZONE4YOU_PRECUTOVER_EVIDENCE_OUTPUT_PATH: outputPath,
  };

  try {
    const result = await writeProductionPreCutoverEvidence({
      environment: outputEnvironment,
      now,
      repositoryRoot: "/repository",
      releaseVerifier: () => releaseEvidence(),
      dnsVerifier: async () => dnsEvidence(),
    });
    const stored = readFileSync(outputPath);
    assert.equal(statSync(outputPath).mode & 0o777, 0o600);
    assert.equal(result.evidenceStoredOwnerOnly, true);
    assert.equal(result.evidenceSha256, createHash("sha256").update(stored).digest("hex"));
    assert.equal(JSON.parse(stored.toString("utf8")).decision, "GO_TO_AUTHORIZED_DNS_CHANGE");

    await assert.rejects(
      writeProductionPreCutoverEvidence({
        environment: outputEnvironment,
        now,
        repositoryRoot: "/repository",
        releaseVerifier: () => releaseEvidence(),
        dnsVerifier: async () => dnsEvidence(),
      }),
      /will not be overwritten/i,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
