import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
    ["luxart", "runtime", "booking", "rollback", "alert"].map((name) => {
      const path = join(directory, `${name}.json`);
      writeFileSync(path, `${JSON.stringify({
        ok: true,
        checkedAt,
        ...(name === "alert" ? { eventId: "da7a9313-19f9-4338-b15e-0d129364b7ee" } : {}),
      })}\n`, "utf8");
      return [name, path];
    }),
  );
  const outputPath = join(directory, "pilot-release-dossier.json");
  const environment = {
    ZONE4YOU_RELEASE_DOSSIER_OUTPUT_PATH: outputPath,
    ZONE4YOU_RELEASE_ID: "zone4you-pilot-2026-09-05",
    ZONE4YOU_RELEASE_COMMIT: "1234567890abcdef1234567890abcdef12345678",
    ZONE4YOU_DEPLOYMENT_PHASE: "booking_without_payments",
    ZONE4YOU_STAGING_APP_ORIGIN: "https://staging.booking.zone4you.cz/",
    LUXART_API_BASE_URL: "https://luxart-test.example.com:9759/",
    ZONE4YOU_RELEASE_WINDOW_STARTS_AT: "2026-09-05T08:00:00.000Z",
    ZONE4YOU_RELEASE_WINDOW_ENDS_AT: "2026-09-05T12:00:00.000Z",
    ZONE4YOU_LUXART_EVIDENCE_PATH: evidencePaths.luxart,
    ZONE4YOU_RUNTIME_EVIDENCE_PATH: evidencePaths.runtime,
    ZONE4YOU_BOOKING_UAT_EVIDENCE_PATH: evidencePaths.booking,
    ZONE4YOU_ROLLBACK_EVIDENCE_PATH: evidencePaths.rollback,
    ZONE4YOU_ALERT_EVIDENCE_PATH: evidencePaths.alert,
  } satisfies Record<string, string | undefined>;
  return { directory, evidencePaths, environment, outputPath };
}

test("dossier preparation hashes real evidence but remains an explicit human-approval draft", () => {
  const { environment, evidencePaths, outputPath } = fixture();
  const result = writePilotReleaseDossier(environment);
  const body = readFileSync(outputPath, "utf8");
  const dossier = JSON.parse(body) as {
    draft: boolean;
    artifacts: Record<string, { path: string; sha256: string }>;
    approvals: {
      uat: { decision: string; approvedBy: string };
      alertReceipt: { confirmed: boolean; eventId: string };
      cutover: { approved: boolean };
    };
  };

  assert.equal(result.ok, true);
  assert.equal(result.draft, true);
  assert.equal(result.artifactCount, 5);
  assert.equal(result.dossierSha256, createHash("sha256").update(body).digest("hex"));
  assert.equal(dossier.draft, true);
  assert.equal(dossier.approvals.uat.decision, "NO-GO");
  assert.equal(dossier.approvals.uat.approvedBy, "pending-human-approval");
  assert.equal(dossier.approvals.alertReceipt.confirmed, false);
  assert.equal(dossier.approvals.cutover.approved, false);
  assert.equal(dossier.artifacts.luxartReadOnly.path, evidencePaths.luxart);
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
});
