import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runLuxartHelpProbe } from "./probe-luxart-help";
import { verifyLuxartGatewayConfiguration } from "./verify-luxart-gateway-config";
import { runLuxartReadonlyVerification } from "./verify-luxart-readonly";
import {
  approvedLuxartReferenceSemanticContractSha256,
  luxartPublicContractEndpoints,
  verifyLuxartContractDocumentation,
} from "./verify-luxart-public-contract";
import { assertSupportedLuxartApiContract } from "../src/lib/luxartApiContract";
import { loadLuxartGatewayAuthConfig } from "../src/lib/luxartGatewayAuth";

type Environment = Record<string, string | undefined>;
type HelpEvidence = Awaited<ReturnType<typeof runLuxartHelpProbe>>;
type ReadonlyEvidence = Awaited<ReturnType<typeof runLuxartReadonlyVerification>>;
type GatewayEvidence = ReturnType<typeof verifyLuxartGatewayConfiguration>;
type ContractEvidence = Awaited<ReturnType<typeof verifyLuxartContractDocumentation>>;

interface LuxartD1Dependencies {
  helpProbe?: (options: { environment: Environment; now: Date }) => Promise<HelpEvidence>;
  gatewayVerifier?: (environment: Environment) => GatewayEvidence;
  contractVerifier?: (options: {
    environment: Environment;
    origin: string;
    now: Date;
  }) => Promise<ContractEvidence>;
  readonlyVerifier?: (options: { environment: Environment; now: Date }) => Promise<ReadonlyEvidence>;
}

interface LuxartD1Options extends LuxartD1Dependencies {
  environment?: Environment;
  now?: Date;
  repositoryRoot?: string;
}

const repositoryRootDefault = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for the Luxart D1 verification.`);
  return value;
}

function effectivePort(url: URL) {
  return url.port || (url.protocol === "https:" ? "443" : "80");
}

function cleanHttpsUrl(raw: string, name: string, pathname: RegExp) {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.hostname.endsWith(".invalid") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !pathname.test(url.pathname)
  ) {
    throw new Error(`${name} must be the approved clean HTTPS Luxart URL.`);
  }
  return url;
}

function approvedOriginFingerprint(environment: Environment, origin: string) {
  const approved = required(environment, "LUXART_APPROVED_ORIGIN_SHA256");
  if (!/^[a-f0-9]{64}$/.test(approved)) {
    throw new Error("LUXART_APPROVED_ORIGIN_SHA256 must be a full lowercase SHA-256 fingerprint.");
  }
  const actual = createHash("sha256").update(origin).digest("hex");
  if (approved !== actual) {
    throw new Error("LUXART_APPROVED_ORIGIN_SHA256 does not match the configured Luxart origin.");
  }
  return actual;
}

function outputTarget(raw: string, repositoryRoot: string) {
  const outputPath = resolve(raw);
  if (!outputPath.endsWith(".json")) {
    throw new Error("ZONE4YOU_LUXART_EVIDENCE_OUTPUT_PATH must end in .json.");
  }
  const fromRepository = relative(resolve(repositoryRoot), outputPath);
  if (fromRepository === "" || (!fromRepository.startsWith("..") && !isAbsolute(fromRepository))) {
    throw new Error("Luxart release evidence must be stored outside the repository.");
  }
  if (existsSync(outputPath)) {
    throw new Error("Luxart evidence output already exists and will not be overwritten.");
  }
  const parent = lstatSync(dirname(outputPath));
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw new Error("Luxart evidence parent must be a real directory.");
  }
  if ((parent.mode & 0o077) !== 0) {
    throw new Error("Luxart evidence parent must not be accessible by group or other users.");
  }
  return outputPath;
}

export function loadLuxartD1Configuration(
  environment: Environment = process.env,
  repositoryRoot = repositoryRootDefault,
) {
  if (environment.LUXART_MOCK !== "false") {
    throw new Error("Luxart D1 verification requires LUXART_MOCK=false.");
  }
  const apiContract = assertSupportedLuxartApiContract(environment);
  if (environment.LUXART_ALLOW_INSECURE_TEST_HTTP !== "false") {
    throw new Error("Luxart D1 verification refuses the insecure HTTP override.");
  }
  if (environment.LUXART_REQUIRE_AUTHENTICATED_PROBE !== "true") {
    throw new Error("Luxart D1 verification requires the authenticated read-only probe.");
  }
  if (environment.LUXART_RESORT_ID !== "1") {
    throw new Error("Luxart D1 verification is locked to Zone4You resort 1.");
  }

  const apiUrl = cleanHttpsUrl(required(environment, "LUXART_API_BASE_URL"), "LUXART_API_BASE_URL", /^\/$/);
  const helpUrl = cleanHttpsUrl(required(environment, "LUXART_HELP_URL"), "LUXART_HELP_URL", /^\/Help\/?$/i);
  if (apiUrl.origin !== helpUrl.origin) {
    throw new Error("LUXART_API_BASE_URL and LUXART_HELP_URL must use the same approved origin.");
  }
  const targetFingerprintSha256 = approvedOriginFingerprint(environment, apiUrl.origin);

  return {
    apiOrigin: apiUrl.origin,
    apiContract,
    port: effectivePort(apiUrl),
    targetFingerprintSha256,
    outputPath: outputTarget(
      required(environment, "ZONE4YOU_LUXART_EVIDENCE_OUTPUT_PATH"),
      repositoryRoot,
    ),
  };
}

function helpAccepted(help: HelpEvidence, gateway: GatewayEvidence) {
  if (help.classification === "ready") return true;
  return help.classification === "authentication_required" && gateway.gatewayAuthMode !== "none";
}

async function verifyD1ContractDocumentation({
  environment,
  origin,
  now,
}: {
  environment: Environment;
  origin: string;
  now: Date;
}) {
  const gateway = loadLuxartGatewayAuthConfig(environment);
  return verifyLuxartContractDocumentation({
    origin,
    now,
    requestHeaders: gateway.headers,
  });
}

export async function runLuxartD1Verification({
  environment = process.env,
  now = new Date(),
  repositoryRoot = repositoryRootDefault,
  helpProbe = runLuxartHelpProbe,
  gatewayVerifier = verifyLuxartGatewayConfiguration,
  contractVerifier = verifyD1ContractDocumentation,
  readonlyVerifier = runLuxartReadonlyVerification,
}: LuxartD1Options = {}) {
  const configuration = loadLuxartD1Configuration(environment, repositoryRoot);
  const gateway = gatewayVerifier(environment);
  const help = await helpProbe({
    environment: { ...environment, LUXART_EXPECTED_PORT: configuration.port },
    now,
  });
  if (
    help.targetFingerprintSha256 !== configuration.targetFingerprintSha256 ||
    help.transport !== "https" ||
    help.port !== configuration.port
  ) {
    throw new Error("Luxart Help evidence does not match the approved HTTPS origin.");
  }
  const helpHttpStatus = "httpStatus" in help ? help.httpStatus : undefined;
  const helpBodySha256 = "bodySha256" in help ? help.bodySha256 : undefined;
  if (
    help.classification === "ready" &&
    (help.ok !== true || help.reached !== true || helpHttpStatus !== 200 || !/^[a-f0-9]{64}$/.test(helpBodySha256 ?? ""))
  ) {
    throw new Error("Luxart Help ready evidence is internally inconsistent.");
  }
  if (
    help.classification === "authentication_required" &&
    (help.ok !== false || help.reached !== true || ![401, 403].includes(helpHttpStatus ?? 0))
  ) {
    throw new Error("Luxart Help authentication challenge evidence is internally inconsistent.");
  }
  if (!helpAccepted(help, gateway)) {
    throw new Error(`Luxart Help transport check did not pass safely (${help.classification}).`);
  }

  const contract = await contractVerifier({
    environment,
    origin: configuration.apiOrigin,
    now,
  });
  if (
    contract.ok !== true ||
    contract.checkedAt !== now.toISOString() ||
    contract.targetFingerprintSha256 !== configuration.targetFingerprintSha256 ||
    contract.expectedEndpointCount !== luxartPublicContractEndpoints.length ||
    contract.verifiedEndpointCount !== luxartPublicContractEndpoints.length ||
    contract.expectedSemanticContractSha256 !== approvedLuxartReferenceSemanticContractSha256 ||
    contract.semanticContractSha256 !== approvedLuxartReferenceSemanticContractSha256 ||
    contract.issues.length !== 0
  ) {
    throw new Error("Luxart REST contract documentation does not match the approved semantic baseline.");
  }

  const evidence = await readonlyVerifier({ environment, now });
  if (!evidence.ok || evidence.target !== configuration.apiOrigin) {
    throw new Error("Luxart read-only evidence does not match the approved API origin.");
  }
  if (evidence.apiContract !== configuration.apiContract) {
    throw new Error("Luxart read-only evidence does not match the approved REST API contract.");
  }
  if (evidence.gatewayAuthMode !== gateway.gatewayAuthMode) {
    throw new Error("Luxart read-only evidence does not match the confirmed gateway auth mode.");
  }
  if (!evidence.authenticated || evidence.authenticated.checked !== true) {
    throw new Error("Luxart read-only evidence is not authenticated.");
  }
  if (!evidence.personalized || evidence.personalized.checked !== true) {
    throw new Error("Luxart read-only evidence does not verify personalized lesson eligibility.");
  }

  const d1Evidence = {
    ...evidence,
    d1: {
      schemaVersion: 3,
      checkedAt: help.checkedAt,
      targetFingerprintSha256: configuration.targetFingerprintSha256,
      helpClassification: help.classification,
      helpTransport: help.transport,
      helpPort: help.port,
      helpHttpStatus,
      ...(help.classification === "ready" ? { helpBodySha256 } : {}),
      gatewayAuthMode: gateway.gatewayAuthMode,
      apiContract: configuration.apiContract,
      contractCheckedAt: contract.checkedAt,
      contractEndpointCount: contract.verifiedEndpointCount,
      contractSemanticSha256: contract.semanticContractSha256,
      contractBaselineVerified: true,
      approvedOriginFingerprintVerified: true,
      authenticatedReadOnlyVerified: true,
      personalizedLessonSetVerified: true,
    },
  };
  const body = `${JSON.stringify(d1Evidence, null, 2)}\n`;
  writeFileSync(configuration.outputPath, body, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const storedBytes = readFileSync(configuration.outputPath);
  const storedMode = lstatSync(configuration.outputPath).mode & 0o777;
  if (storedMode !== 0o600) {
    throw new Error("Luxart evidence file permissions are not owner-only.");
  }

  return {
    ok: true,
    checkedAt: evidence.checkedAt,
    port: configuration.port,
    apiContract: configuration.apiContract,
    targetFingerprintSha256: configuration.targetFingerprintSha256,
    helpClassification: help.classification,
    gatewayAuthMode: gateway.gatewayAuthMode,
    contractEndpointCount: contract.verifiedEndpointCount,
    contractSemanticSha256: contract.semanticContractSha256,
    authenticated: true,
    czechLessonCount: evidence.czech.count,
    englishLessonCount: evidence.english.count,
    reformerCount: evidence.czech.reformer,
    observedRoomNumbers: evidence.czech.roomNumbers,
    eligibleLessonCount: evidence.personalized.czech.eligible,
    ineligibleLessonCount: evidence.personalized.czech.ineligible,
    personalizedLessonSetMatched: true,
    evidenceSha256: createHash("sha256").update(storedBytes).digest("hex"),
    evidenceStoredOwnerOnly: true,
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runLuxartD1Verification()
    .then((receipt) => console.log(JSON.stringify(receipt, null, 2)))
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Luxart D1 verification failed.",
      }, null, 2));
      process.exitCode = 1;
    });
}
