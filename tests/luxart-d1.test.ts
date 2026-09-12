import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadLuxartD1Configuration,
  runLuxartD1Verification,
} from "../scripts/verify-luxart-d1";
import {
  approvedLuxartReferenceSemanticContractSha256,
  luxartPublicContractEndpoints,
} from "../scripts/verify-luxart-public-contract";

const now = new Date("2026-09-11T14:00:00.000Z");
const approvedOrigin = "https://zone4you-api.example.cz:9443";
const approvedOriginFingerprint = createHash("sha256").update(approvedOrigin).digest("hex");

function environment(outputPath: string) {
  return {
    LUXART_MOCK: "false",
    LUXART_API_CONTRACT: "memberzone_rest_v1",
    LUXART_API_BASE_URL: approvedOrigin,
    LUXART_HELP_URL: `${approvedOrigin}/Help`,
    LUXART_APPROVED_ORIGIN_SHA256: approvedOriginFingerprint,
    LUXART_ALLOW_INSECURE_TEST_HTTP: "false",
    LUXART_REQUIRE_AUTHENTICATED_PROBE: "true",
    LUXART_RESORT_ID: "1",
    LUXART_API_AUTH_MODE: "none",
    LUXART_API_AUTH_CONFIRMED: "true",
    LUXART_TEST_LOGIN: "test-client",
    LUXART_TEST_PASSWORD: "not-printed",
    ZONE4YOU_LUXART_EVIDENCE_OUTPUT_PATH: outputPath,
  };
}

function readonlyEvidence(gatewayAuthMode: "none" | "basic" = "none") {
  const feed = {
    count: 24,
    occurrenceSetSha256: "a".repeat(64),
    roomPlacementSetSha256: "d".repeat(64),
    lessonContentSetSha256: "e".repeat(64),
    rooms: ["Sál 1", "Sál 2", "Sál 3", "Reformer"],
    roomNumbers: [1, 2, 3, 4],
    reformer: 3,
    earliestStartsAt: "2026-09-11T15:00:00.000Z",
    latestStartsAt: "2026-09-17T18:00:00.000Z",
    dateKeys: ["2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"],
  };
  return {
    ok: true as const,
    checkedAt: now.toISOString(),
    target: approvedOrigin,
    apiContract: "memberzone_rest_v1" as const,
    gatewayAuthMode,
    range: {
      from: "2026-09-10T22:00:00.000Z",
      to: "2026-09-17T22:00:00.000Z",
      days: 7,
      timeZone: "Europe/Prague",
    },
    czech: feed,
    english: feed,
    authenticated: {
      checked: true,
      userLoaded: true,
      reservations: 0,
      creditTransactions: 1,
    },
    personalized: {
      checked: true as const,
      czech: { ...feed, eligible: 18, ineligible: 6 },
      english: { ...feed, eligible: 18, ineligible: 6 },
    },
  };
}

function contractEvidence(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    checkedAt: now.toISOString(),
    targetFingerprintSha256: approvedOriginFingerprint,
    expectedEndpointCount: luxartPublicContractEndpoints.length,
    verifiedEndpointCount: luxartPublicContractEndpoints.length,
    expectedSemanticContractSha256: approvedLuxartReferenceSemanticContractSha256,
    semanticContractSha256: approvedLuxartReferenceSemanticContractSha256,
    issues: [],
    ...overrides,
  };
}

test("D1 configuration is locked to the exact approved HTTPS REST origin and a protected external file", () => {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-d1-"));
  try {
    const outputPath = join(directory, "luxart.json");
    assert.deepEqual(loadLuxartD1Configuration(environment(outputPath), "/repository"), {
      apiOrigin: approvedOrigin,
      apiContract: "memberzone_rest_v1",
      port: "9443",
      targetFingerprintSha256: approvedOriginFingerprint,
      outputPath,
    });

    const unsafe = [
      { LUXART_API_BASE_URL: "http://zone4you-api.example.cz:9443" },
      { LUXART_HELP_URL: "https://other.example.cz:9443/Help" },
      { LUXART_APPROVED_ORIGIN_SHA256: "a".repeat(64) },
      { LUXART_APPROVED_ORIGIN_SHA256: "not-a-fingerprint" },
      { LUXART_API_CONTRACT: "soap_wcf" },
      { LUXART_ALLOW_INSECURE_TEST_HTTP: "true" },
      { LUXART_REQUIRE_AUTHENTICATED_PROBE: "false" },
    ];
    for (const drift of unsafe) {
      assert.throws(
        () => loadLuxartD1Configuration({ ...environment(outputPath), ...drift }, "/repository"),
        /HTTPS|REST|same approved origin|SHA-256|does not match|must exactly equal|refuses|authenticated/i,
      );
    }

    const alternateRestOrigin = "https://rest-gateway.example.cz:9759";
    assert.deepEqual(loadLuxartD1Configuration({
      ...environment(outputPath),
      LUXART_API_BASE_URL: alternateRestOrigin,
      LUXART_HELP_URL: `${alternateRestOrigin}/Help`,
      LUXART_APPROVED_ORIGIN_SHA256: createHash("sha256").update(alternateRestOrigin).digest("hex"),
    }, "/repository"), {
      apiOrigin: alternateRestOrigin,
      apiContract: "memberzone_rest_v1",
      port: "9759",
      targetFingerprintSha256: createHash("sha256").update(alternateRestOrigin).digest("hex"),
      outputPath,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("D1 binds transport, gateway, semantic contract and authenticated read-only checks before storing evidence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-d1-"));
  try {
    const outputPath = join(directory, "luxart.json");
    const env = environment(outputPath);
    const calls: string[] = [];
    const receipt = await runLuxartD1Verification({
      environment: env,
      now,
      repositoryRoot: "/repository",
      gatewayVerifier: () => {
        calls.push("gateway");
        return {
          ok: true,
          checkedAt: now.toISOString(),
          gatewayAuthMode: "none",
          authorizationHeaderConfigured: false,
          gatewayDecisionConfirmed: true,
        };
      },
      helpProbe: async ({ environment: probeEnvironment }) => {
        calls.push("help");
        assert.equal(probeEnvironment.LUXART_EXPECTED_PORT, "9443");
        return {
          ok: true,
          checkedAt: now.toISOString(),
          targetFingerprintSha256: approvedOriginFingerprint,
          transport: "https",
          port: "9443",
          reached: true,
          httpStatus: 200,
          classification: "ready",
          bodySha256: "c".repeat(64),
        };
      },
      contractVerifier: async ({ origin }) => {
        calls.push("contract");
        assert.equal(origin, approvedOrigin);
        return contractEvidence();
      },
      readonlyVerifier: async () => {
        calls.push("readonly");
        return readonlyEvidence();
      },
    });

    assert.deepEqual(calls, ["gateway", "help", "contract", "readonly"]);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.apiContract, "memberzone_rest_v1");
    assert.equal(receipt.port, "9443");
    assert.equal(receipt.targetFingerprintSha256, approvedOriginFingerprint);
    assert.equal(receipt.czechLessonCount, 24);
    assert.equal(receipt.reformerCount, 3);
    assert.equal(receipt.eligibleLessonCount, 18);
    assert.equal(receipt.ineligibleLessonCount, 6);
    assert.equal(receipt.personalizedLessonSetMatched, true);
    assert.equal(receipt.contractEndpointCount, 11);
    assert.equal(receipt.contractSemanticSha256, approvedLuxartReferenceSemanticContractSha256);
    assert.equal(receipt.evidenceStoredOwnerOnly, true);
    assert.match(receipt.evidenceSha256, /^[a-f0-9]{64}$/);
    assert.equal(lstatSync(outputPath).mode & 0o777, 0o600);
    const stored = readFileSync(outputPath, "utf8");
    assert.doesNotMatch(stored, /not-printed|test-client/);
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    const d1 = parsed.d1;
    delete parsed.d1;
    assert.deepEqual(parsed, readonlyEvidence());
    assert.deepEqual(d1, {
      schemaVersion: 3,
      checkedAt: now.toISOString(),
      targetFingerprintSha256: approvedOriginFingerprint,
      helpClassification: "ready",
      helpTransport: "https",
      helpPort: "9443",
      helpHttpStatus: 200,
      helpBodySha256: "c".repeat(64),
      gatewayAuthMode: "none",
      apiContract: "memberzone_rest_v1",
      contractCheckedAt: now.toISOString(),
      contractEndpointCount: 11,
      contractSemanticSha256: approvedLuxartReferenceSemanticContractSha256,
      contractBaselineVerified: true,
      approvedOriginFingerprintVerified: true,
      authenticatedReadOnlyVerified: true,
      personalizedLessonSetVerified: true,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("D1 rejects Help evidence from a different origin before the authenticated read-only request", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-d1-"));
  try {
    const outputPath = join(directory, "luxart.json");
    let readonlyCalls = 0;
    await assert.rejects(
      runLuxartD1Verification({
        environment: environment(outputPath),
        now,
        repositoryRoot: "/repository",
        gatewayVerifier: () => ({
          ok: true,
          checkedAt: now.toISOString(),
          gatewayAuthMode: "none",
          authorizationHeaderConfigured: false,
          gatewayDecisionConfirmed: true,
        }),
        helpProbe: async () => ({
          ok: true,
          checkedAt: now.toISOString(),
          targetFingerprintSha256: "d".repeat(64),
          transport: "https",
          port: "9443",
          reached: true,
          httpStatus: 200,
          classification: "ready",
          bodySha256: "c".repeat(64),
        }),
        readonlyVerifier: async () => {
          readonlyCalls += 1;
          return readonlyEvidence();
        },
      }),
      /does not match the approved HTTPS origin/i,
    );
    assert.equal(readonlyCalls, 0);
    assert.equal(existsSync(outputPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("D1 rejects internally inconsistent Help success before the authenticated read-only request", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-d1-"));
  try {
    const outputPath = join(directory, "luxart.json");
    let readonlyCalls = 0;
    await assert.rejects(
      runLuxartD1Verification({
        environment: environment(outputPath),
        now,
        repositoryRoot: "/repository",
        gatewayVerifier: () => ({
          ok: true,
          checkedAt: now.toISOString(),
          gatewayAuthMode: "none",
          authorizationHeaderConfigured: false,
          gatewayDecisionConfirmed: true,
        }),
        helpProbe: async () => ({
          ok: true,
          checkedAt: now.toISOString(),
          targetFingerprintSha256: approvedOriginFingerprint,
          transport: "https",
          port: "9443",
          reached: true,
          httpStatus: 204,
          classification: "ready",
          bodySha256: "c".repeat(64),
        }),
        readonlyVerifier: async () => {
          readonlyCalls += 1;
          return readonlyEvidence();
        },
      }),
      /ready evidence is internally inconsistent/i,
    );
    assert.equal(readonlyCalls, 0);
    assert.equal(existsSync(outputPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("D1 rejects an unavailable Help path before the authenticated read-only request", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-d1-"));
  try {
    const outputPath = join(directory, "luxart.json");
    let readonlyCalls = 0;
    await assert.rejects(
      runLuxartD1Verification({
        environment: environment(outputPath),
        now,
        repositoryRoot: "/repository",
        gatewayVerifier: () => ({
          ok: true,
          checkedAt: now.toISOString(),
          gatewayAuthMode: "none",
          authorizationHeaderConfigured: false,
          gatewayDecisionConfirmed: true,
        }),
        helpProbe: async () => ({
          ok: false,
          checkedAt: now.toISOString(),
          targetFingerprintSha256: approvedOriginFingerprint,
          transport: "https",
          port: "9443",
          reached: false,
          classification: "network_unavailable",
          networkCode: "TIMEOUT",
        }),
        readonlyVerifier: async () => {
          readonlyCalls += 1;
          return readonlyEvidence();
        },
      }),
      /did not pass safely/i,
    );
    assert.equal(readonlyCalls, 0);
    assert.equal(existsSync(outputPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("D1 rejects a detected SOAP/WCF candidate before credentials or authenticated reads", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-d1-"));
  try {
    const outputPath = join(directory, "luxart.json");
    let readonlyCalls = 0;
    await assert.rejects(
      runLuxartD1Verification({
        environment: environment(outputPath),
        now,
        repositoryRoot: "/repository",
        gatewayVerifier: () => ({
          ok: true,
          checkedAt: now.toISOString(),
          gatewayAuthMode: "none",
          authorizationHeaderConfigured: false,
          gatewayDecisionConfirmed: true,
        }),
        helpProbe: async () => ({
          ok: false,
          checkedAt: now.toISOString(),
          targetFingerprintSha256: approvedOriginFingerprint,
          transport: "https",
          port: "9443",
          reached: true,
          httpStatus: 404,
          classification: "soap_wcf_not_rest",
          candidateContract: "soap_wcf",
          directoryBrowsingDetected: true,
          launchAuthority: false,
          credentialsAuthorized: false,
        }),
        readonlyVerifier: async () => {
          readonlyCalls += 1;
          return readonlyEvidence();
        },
      }),
      /did not pass safely \(soap_wcf_not_rest\)/i,
    );
    assert.equal(readonlyCalls, 0);
    assert.equal(existsSync(outputPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("D1 accepts an authentication challenge only when a non-empty gateway mode was confirmed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-d1-"));
  try {
    const outputPath = join(directory, "luxart.json");
    const env = {
      ...environment(outputPath),
      LUXART_API_AUTH_MODE: "basic",
      LUXART_API_BASIC_USERNAME: "gateway-user",
      LUXART_API_BASIC_PASSWORD: "gateway-password",
    };
    const receipt = await runLuxartD1Verification({
      environment: env,
      now,
      repositoryRoot: "/repository",
      gatewayVerifier: () => ({
        ok: true,
        checkedAt: now.toISOString(),
        gatewayAuthMode: "basic",
        authorizationHeaderConfigured: true,
        gatewayDecisionConfirmed: true,
      }),
      helpProbe: async () => ({
        ok: false,
        checkedAt: now.toISOString(),
        targetFingerprintSha256: approvedOriginFingerprint,
        transport: "https",
        port: "9443",
        reached: true,
        httpStatus: 401,
        classification: "authentication_required",
      }),
      contractVerifier: async () => contractEvidence(),
      readonlyVerifier: async () => readonlyEvidence("basic"),
    });
    assert.equal(receipt.helpClassification, "authentication_required");
    assert.equal(receipt.gatewayAuthMode, "basic");
    assert.equal(lstatSync(outputPath).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("D1 rejects semantic contract drift before authenticated reads or evidence storage", async () => {
  const directory = mkdtempSync(join(tmpdir(), "zone4you-d1-"));
  try {
    const outputPath = join(directory, "luxart.json");
    let readonlyCalls = 0;
    await assert.rejects(
      runLuxartD1Verification({
        environment: environment(outputPath),
        now,
        repositoryRoot: "/repository",
        gatewayVerifier: () => ({
          ok: true,
          checkedAt: now.toISOString(),
          gatewayAuthMode: "none",
          authorizationHeaderConfigured: false,
          gatewayDecisionConfirmed: true,
        }),
        helpProbe: async () => ({
          ok: true,
          checkedAt: now.toISOString(),
          targetFingerprintSha256: approvedOriginFingerprint,
          transport: "https",
          port: "9443",
          reached: true,
          httpStatus: 200,
          classification: "ready",
          bodySha256: "c".repeat(64),
        }),
        contractVerifier: async () => contractEvidence({
          ok: false,
          semanticContractSha256: "f".repeat(64),
          issues: [{ endpoint: "contract", code: "CONTRACT_DRIFT" }],
        }),
        readonlyVerifier: async () => {
          readonlyCalls += 1;
          return readonlyEvidence();
        },
      }),
      /does not match the approved semantic baseline/i,
    );
    assert.equal(readonlyCalls, 0);
    assert.equal(existsSync(outputPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
