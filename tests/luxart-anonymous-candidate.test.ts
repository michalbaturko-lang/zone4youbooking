import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  loadAnonymousLuxartCandidateConfiguration,
  runAnonymousLuxartCandidateVerification,
} from "../scripts/verify-luxart-anonymous-candidate";
import {
  approvedLuxartReferenceSemanticContractSha256,
  luxartPublicContractEndpoints,
} from "../scripts/verify-luxart-public-contract";

const now = new Date("2026-09-13T20:00:00.000Z");
const environment = {
  LUXART_HELP_URL: "https://zone4you-api.example.cz:9191/Help",
  LUXART_EXPECTED_PORT: "9191",
  LUXART_HELP_PROBE_TIMEOUT_MS: "4000",
  LUXART_API_BASIC_PASSWORD: "must-not-be-read",
  LUXART_TEST_PASSWORD: "must-not-be-read",
};
const fingerprint = createHash("sha256").update("https://zone4you-api.example.cz:9191").digest("hex");
const helpBodySha256 = "a".repeat(64);

function readyHelp() {
  return {
    ok: true,
    checkedAt: now.toISOString(),
    targetFingerprintSha256: fingerprint,
    transport: "https" as const,
    port: "9191",
    reached: true,
    classification: "ready" as const,
    launchAuthority: false as const,
    credentialsAuthorized: false as const,
    httpStatus: 200,
    bodySha256: helpBodySha256,
    directoryBrowsingChecked: true,
    directoryBrowsingDetected: false,
  };
}

function readyContract() {
  return {
    ok: true,
    checkedAt: now.toISOString(),
    targetFingerprintSha256: fingerprint,
    expectedEndpointCount: luxartPublicContractEndpoints.length,
    verifiedEndpointCount: luxartPublicContractEndpoints.length,
    expectedSemanticContractSha256: approvedLuxartReferenceSemanticContractSha256,
    semanticContractSha256: approvedLuxartReferenceSemanticContractSha256,
    issues: [],
  };
}

test("anonymous candidate requires an exact HTTPS Help URL and port", () => {
  assert.throws(
    () => loadAnonymousLuxartCandidateConfiguration({
      LUXART_HELP_URL: "http://zone4you-api.example.cz:9191/Help",
      LUXART_EXPECTED_PORT: "9191",
    }),
    /requires HTTPS/i,
  );
  assert.throws(
    () => loadAnonymousLuxartCandidateConfiguration({
      LUXART_HELP_URL: "https://zone4you-api.example.cz:9191/Help",
    }),
    /EXPECTED_PORT is required/i,
  );
  assert.throws(
    () => loadAnonymousLuxartCandidateConfiguration({
      ...environment,
      LUXART_ALLOW_INSECURE_TEST_HTTP: "true",
    }),
    /refuses the HTTP override/i,
  );
});

test("green anonymous candidate proves the exact public REST contract but authorizes no credentials", async () => {
  let contractCalls = 0;
  const report = await runAnonymousLuxartCandidateVerification({
    environment,
    now,
    helpProbe: async ({ environment: isolated }) => {
      assert.deepEqual(Object.keys(isolated).sort(), [
        "LUXART_ALLOW_INSECURE_TEST_HTTP",
        "LUXART_EXPECTED_PORT",
        "LUXART_HELP_PROBE_TIMEOUT_MS",
        "LUXART_HELP_URL",
      ]);
      assert.equal(JSON.stringify(isolated).includes("must-not-be-read"), false);
      return readyHelp();
    },
    contractVerifier: async ({ origin, now: checkedAt, timeoutMs }) => {
      contractCalls += 1;
      assert.equal(origin, "https://zone4you-api.example.cz:9191");
      assert.equal(checkedAt, now);
      assert.equal(timeoutMs, 4000);
      return readyContract();
    },
  });

  assert.equal(contractCalls, 1);
  assert.equal(report.ok, true);
  assert.equal(report.d1Eligible, true);
  assert.equal(report.nextGate, "luxart_d1");
  assert.equal(report.credentialsAuthorized, false);
  assert.equal(report.launchAuthority, false);
  assert.equal(JSON.stringify(report).includes("zone4you-api.example.cz"), false);
  assert.equal(JSON.stringify(report).includes("must-not-be-read"), false);
});

test("gateway challenge stops before contract crawling and requests an auth decision", async () => {
  let contractCalls = 0;
  const report = await runAnonymousLuxartCandidateVerification({
    environment,
    now,
    helpProbe: async () => ({
      ...readyHelp(),
      ok: false,
      classification: "authentication_required",
      httpStatus: 401,
      bodySha256: undefined,
    }),
    contractVerifier: async () => {
      contractCalls += 1;
      return readyContract();
    },
  });

  assert.equal(contractCalls, 0);
  assert.equal(report.ok, false);
  assert.equal(report.d1Eligible, false);
  assert.equal(report.nextGate, "confirm_gateway_auth");
  assert.deepEqual(report.contract, { checked: false });
});

test("unsafe root and wrong service stop before all contract requests", async () => {
  for (const [classification, expectedGate] of [
    ["directory_listing_detected", "fix_public_root"],
    ["soap_wcf_not_rest", "fix_transport_or_route"],
  ] as const) {
    let contractCalls = 0;
    const report = await runAnonymousLuxartCandidateVerification({
      environment,
      now,
      helpProbe: async () => ({
        ...readyHelp(),
        ok: false,
        classification,
        bodySha256: undefined,
        candidateContract: classification === "soap_wcf_not_rest" ? "soap_wcf" as const : "unknown" as const,
        directoryBrowsingDetected: classification === "directory_listing_detected",
      }),
      contractVerifier: async () => {
        contractCalls += 1;
        return readyContract();
      },
    });
    assert.equal(contractCalls, 0);
    assert.equal(report.nextGate, expectedGate);
    assert.equal(report.credentialsAuthorized, false);
  }
});

test("semantic drift remains ineligible for D1", async () => {
  const report = await runAnonymousLuxartCandidateVerification({
    environment,
    now,
    helpProbe: async () => readyHelp(),
    contractVerifier: async () => ({
      ...readyContract(),
      ok: false,
      semanticContractSha256: "b".repeat(64),
      issues: [{
        endpoint: "contract",
        code: "CONTRACT_DRIFT" as const,
        expectedSha256: approvedLuxartReferenceSemanticContractSha256,
        actualSha256: "b".repeat(64),
      }],
    }),
  });

  assert.equal(report.ok, false);
  assert.equal(report.d1Eligible, false);
  assert.equal(report.nextGate, "fix_contract");
  assert.equal(report.contract.checked, true);
});

test("candidate evidence is rejected when a dependency switches the target", async () => {
  await assert.rejects(
    runAnonymousLuxartCandidateVerification({
      environment,
      now,
      helpProbe: async () => ({
        ...readyHelp(),
        targetFingerprintSha256: "c".repeat(64),
      }),
    }),
    /does not match the exact HTTPS candidate/i,
  );
});
