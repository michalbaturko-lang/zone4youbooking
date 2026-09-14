import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyLuxartResourceMap } from "../scripts/verify-luxart-resource-map";
import { luxartResourceMappingSha256 } from "../src/lib/luxartResourceMappingFingerprint";

const now = new Date("2026-09-13T15:00:00.000Z");
const resourceMap = JSON.stringify({ 1: 101, 2: 202, 4: 404 });

function d1Evidence(overrides: Record<string, unknown> = {}) {
  const placement = "a".repeat(64);
  const localized = {
    roomNumbers: [1, 2, 4],
    roomPlacementSetSha256: placement,
  };
  return {
    ok: true,
    czech: localized,
    english: localized,
    personalized: {
      checked: true,
      czech: localized,
      english: localized,
    },
    d1: {
      schemaVersion: 6,
      directoryBrowsingChecked: true,
      directoryBrowsingDetected: false,
      contractBaselineVerified: true,
      approvedOriginFingerprintVerified: true,
      authenticatedReadOnlyVerified: true,
      personalizedLessonSetVerified: true,
      loginQueryLoggingConfirmed: true,
      loginQueryLoggingConfirmedBy: "Zone4You IT administrator",
      loginQueryLoggingConfirmedAt: "2026-09-13T14:30:00.000Z",
    },
    ...overrides,
  };
}

function withEvidence(
  run: (context: { directory: string; evidencePath: string; environment: Record<string, string> }) => void,
) {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-resource-map-"));
  const evidencePath = join(directory, "luxart-d1.json");
  writeFileSync(evidencePath, JSON.stringify(d1Evidence()), { mode: 0o600 });
  try {
    run({
      directory,
      evidencePath,
      environment: {
        ZONE4YOU_LUXART_EVIDENCE_PATH: evidencePath,
        LUXART_RESOURCE_MAP_JSON: resourceMap,
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("resource map verifier binds the exact D1 room set without exposing Luxart resource IDs", () => {
  withEvidence(({ environment }) => {
    const result = verifyLuxartResourceMap({ environment, now, repositoryRoot: "/repository" });
    assert.deepEqual(result.observedRoomNumbers, [1, 2, 4]);
    assert.equal(result.observedRoomCount, 3);
    assert.equal(result.mappedRoomCount, 3);
    assert.equal(result.resourceMapSha256, luxartResourceMappingSha256(resourceMap));
    assert.equal(result.resourceIdsExposed, false);
    assert.equal(result.authorizesMutation, false);
    assert.equal(result.authorizesCutover, false);
    assert.equal("mapping" in result, false);
    assert.equal("resourceIds" in result, false);
  });
});

test("resource map verifier reports every missing or unobserved room before UAT", () => {
  withEvidence(({ environment }) => {
    assert.throws(
      () => verifyLuxartResourceMap({
        environment: { ...environment, LUXART_RESOURCE_MAP_JSON: JSON.stringify({ 1: 101, 2: 202 }) },
        repositoryRoot: "/repository",
      }),
      /missing observed room numbers: 4/i,
    );
    assert.throws(
      () => verifyLuxartResourceMap({
        environment: { ...environment, LUXART_RESOURCE_MAP_JSON: JSON.stringify({ 1: 101, 2: 202, 4: 404, 7: 707 }) },
        repositoryRoot: "/repository",
      }),
      /unobserved room numbers: 7/i,
    );
    assert.throws(
      () => verifyLuxartResourceMap({
        environment: { ...environment, LUXART_RESOURCE_MAP_JSON: "" },
        repositoryRoot: "/repository",
      }),
      /required for observed room numbers: 1, 2, 4/i,
    );
  });
});

test("resource map verifier rejects room drift and non-release-grade D1 evidence", () => {
  withEvidence(({ evidencePath, environment }) => {
    writeFileSync(evidencePath, JSON.stringify(d1Evidence({
      english: { roomNumbers: [1, 2, 3], roomPlacementSetSha256: "a".repeat(64) },
    })), { mode: 0o600 });
    assert.throws(
      () => verifyLuxartResourceMap({ environment, repositoryRoot: "/repository" }),
      /English roomNumbers does not match/i,
    );

    writeFileSync(evidencePath, JSON.stringify(d1Evidence({
      d1: {
        schemaVersion: 6,
        directoryBrowsingChecked: true,
        directoryBrowsingDetected: false,
        authenticatedReadOnlyVerified: false,
      },
    })), { mode: 0o600 });
    assert.throws(
      () => verifyLuxartResourceMap({ environment, repositoryRoot: "/repository" }),
      /does not prove the release-grade/i,
    );
  });
});

test("resource map verifier reads only owner-only regular evidence outside the repository", () => {
  withEvidence(({ directory, evidencePath, environment }) => {
    chmodSync(evidencePath, 0o644);
    assert.throws(
      () => verifyLuxartResourceMap({ environment, repositoryRoot: "/repository" }),
      /must not be accessible by group or other users/i,
    );

    const targetPath = join(directory, "target.json");
    const linkPath = join(directory, "link.json");
    writeFileSync(targetPath, JSON.stringify(d1Evidence()), { mode: 0o600 });
    symlinkSync(targetPath, linkPath);
    assert.throws(
      () => verifyLuxartResourceMap({
        environment: { ...environment, ZONE4YOU_LUXART_EVIDENCE_PATH: linkPath },
        repositoryRoot: "/repository",
      }),
      /regular file, not a symlink/i,
    );
  });
});
