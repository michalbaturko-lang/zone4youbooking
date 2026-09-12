import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildPilotReleaseDossier,
  writePilotReleaseDossier,
} from "../scripts/prepare-pilot-release-dossier";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-dossier-preparation-"));
  const checkedAt = "2026-09-05T07:30:00.000Z";
  const evidencePaths = Object.fromEntries(
    ["luxart", "runtime", "booking", "timer", "rollback", "dns", "alert", "memberzone"].map((name) => {
      const path = join(directory, `${name}.json`);
      writeFileSync(path, `${JSON.stringify({
        ok: true,
        checkedAt,
        ...(name === "dns" ? {
          schemaVersion: 1,
          hostname: "booking.zone4you.cz",
          records: [{ type: "A", address: "203.0.113.10" }],
          recordSetSha256: "not-validated-during-preparation",
          rollbackReady: true,
        } : {}),
        ...(name === "alert" ? { eventId: "da7a9313-19f9-4338-b15e-0d129364b7ee" } : {}),
      })}\n`, "utf8");
      return [name, path];
    }),
  );
  chmodSync(evidencePaths.dns, 0o600);
  chmodSync(evidencePaths.memberzone, 0o600);
  chmodSync(evidencePaths.timer, 0o600);
  const outputPath = join(directory, "pilot-release-dossier.json");
  const environment = {
    ZONE4YOU_RELEASE_DOSSIER_OUTPUT_PATH: outputPath,
    ZONE4YOU_RELEASE_ID: "zone4you-pilot-2026-09-05",
    ZONE4YOU_RELEASE_COMMIT: "1234567890abcdef1234567890abcdef12345678",
    ZONE4YOU_DEPLOYMENT_PHASE: "booking_without_payments",
    ZONE4YOU_STAGING_APP_ORIGIN: "https://staging.booking.zone4you.cz/",
    LUXART_API_CONTRACT: "memberzone_rest_v1",
    LUXART_API_BASE_URL: "https://luxart-test.example.com:9443/",
    ZONE4YOU_RELEASE_WINDOW_STARTS_AT: "2026-09-05T08:00:00.000Z",
    ZONE4YOU_RELEASE_WINDOW_ENDS_AT: "2026-09-05T12:00:00.000Z",
    ZONE4YOU_LUXART_EVIDENCE_PATH: evidencePaths.luxart,
    ZONE4YOU_RUNTIME_EVIDENCE_PATH: evidencePaths.runtime,
    ZONE4YOU_BOOKING_UAT_EVIDENCE_PATH: evidencePaths.booking,
    ZONE4YOU_ROLLBACK_TIMER_EVIDENCE_PATH: evidencePaths.timer,
    ZONE4YOU_ROLLBACK_EVIDENCE_PATH: evidencePaths.rollback,
    ZONE4YOU_DNS_BASELINE_EVIDENCE_PATH: evidencePaths.dns,
    ZONE4YOU_ALERT_EVIDENCE_PATH: evidencePaths.alert,
    ZONE4YOU_MEMBERZONE_FALLBACK_EVIDENCE_PATH: evidencePaths.memberzone,
  } satisfies Record<string, string | undefined>;
  return { directory, evidencePaths, environment, outputPath };
}

test("dossier preparation hashes real evidence but remains an explicit human-approval draft", () => {
  const { environment, evidencePaths, outputPath } = fixture();
  const result = writePilotReleaseDossier(environment);
  const body = readFileSync(outputPath, "utf8");
  const dossier = JSON.parse(body) as {
    schemaVersion: number;
    draft: boolean;
    luxartApiContract: string;
    artifacts: Record<string, { path: string; sha256: string }>;
    approvals: {
      uat: { decision: string; approvedBy: string };
      alertReceipt: { confirmed: boolean; eventId: string };
      luxartNotifications: { confirmed: boolean; approvedBy: string };
      cutover: { approved: boolean };
    };
  };

  assert.equal(result.ok, true);
  assert.equal(result.draft, true);
  assert.equal(result.artifactCount, 8);
  assert.equal(result.dossierSha256, createHash("sha256").update(body).digest("hex"));
  assert.equal(dossier.schemaVersion, 6);
  assert.equal(dossier.draft, true);
  assert.equal(dossier.luxartApiContract, "memberzone_rest_v1");
  assert.equal(dossier.approvals.uat.decision, "NO-GO");
  assert.equal(dossier.approvals.uat.approvedBy, "pending-human-approval");
  assert.equal(dossier.approvals.alertReceipt.confirmed, false);
  assert.equal(dossier.approvals.luxartNotifications.confirmed, false);
  assert.equal(dossier.approvals.luxartNotifications.approvedBy, "pending-human-approval");
  assert.equal(dossier.approvals.cutover.approved, false);
  assert.equal(dossier.artifacts.luxartReadOnly.path, evidencePaths.luxart);
  assert.equal(dossier.artifacts.memberzoneFallback.path, evidencePaths.memberzone);
  assert.equal(dossier.artifacts.rollbackTimer.path, evidencePaths.timer);
  assert.equal(
    dossier.artifacts.luxartReadOnly.sha256,
    createHash("sha256").update(readFileSync(evidencePaths.luxart)).digest("hex"),
  );
  assert.equal(statSync(outputPath).mode & 0o777, 0o600);
  assert.throws(() => writePilotReleaseDossier(environment), /EEXIST|file already exists/i);
});

test("dossier preparation refuses failed evidence and unsafe origins", () => {
  const { environment, evidencePaths } = fixture();
  writeFileSync(evidencePaths.runtime, JSON.stringify({ ok: false, checkedAt: "2026-09-05T07:30:00.000Z" }));
  assert.throws(() => buildPilotReleaseDossier(environment), /runtime evidence\.ok must be true/i);

  const clean = fixture();
  assert.throws(
    () => buildPilotReleaseDossier({
      ...clean.environment,
      ZONE4YOU_STAGING_APP_ORIGIN: "https://booking.zone4you.cz/",
    }),
    /must not be production/i,
  );

  const wrongLuxartContract = fixture();
  assert.throws(
    () => buildPilotReleaseDossier({
      ...wrongLuxartContract.environment,
      LUXART_API_CONTRACT: "soap_wcf",
    }),
    /LUXART_API_CONTRACT must exactly equal memberzone_rest_v1/i,
  );

  const writableEvidence = fixture();
  chmodSync(writableEvidence.evidencePaths.runtime, 0o660);
  assert.throws(
    () => buildPilotReleaseDossier(writableEvidence.environment),
    /runtime evidence must not be writable by group or other users/i,
  );

  const readableDnsEvidence = fixture();
  chmodSync(readableDnsEvidence.evidencePaths.dns, 0o640);
  assert.throws(
    () => buildPilotReleaseDossier(readableDnsEvidence.environment),
    /DNS rollback baseline evidence must not be accessible by group or other users/i,
  );

  const readableMemberzoneEvidence = fixture();
  chmodSync(readableMemberzoneEvidence.evidencePaths.memberzone, 0o640);
  assert.throws(
    () => buildPilotReleaseDossier(readableMemberzoneEvidence.environment),
    /Memberzone fallback evidence must not be accessible by group or other users/i,
  );

  const readableRollbackTimerEvidence = fixture();
  chmodSync(readableRollbackTimerEvidence.evidencePaths.timer, 0o640);
  assert.throws(
    () => buildPilotReleaseDossier(readableRollbackTimerEvidence.environment),
    /Rollback timer evidence must not be accessible by group or other users/i,
  );

  const symlinkedEvidence = fixture();
  const runtimeLink = join(symlinkedEvidence.directory, "runtime-link.json");
  symlinkSync(symlinkedEvidence.evidencePaths.runtime, runtimeLink);
  assert.throws(
    () => buildPilotReleaseDossier({
      ...symlinkedEvidence.environment,
      ZONE4YOU_RUNTIME_EVIDENCE_PATH: runtimeLink,
    }),
    /runtime evidence must be an existing regular file, not a symlink/i,
  );
});
