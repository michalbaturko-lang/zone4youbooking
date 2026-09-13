import { pathToFileURL } from "node:url";
import {
  loadLuxartHelpProbeConfiguration,
  runLuxartHelpProbe,
} from "./probe-luxart-help";
import {
  approvedLuxartReferenceSemanticContractSha256,
  luxartPublicContractEndpoints,
  verifyLuxartContractDocumentation,
} from "./verify-luxart-public-contract";

type Environment = Record<string, string | undefined>;
type HelpEvidence = Awaited<ReturnType<typeof runLuxartHelpProbe>>;
type ContractEvidence = Awaited<ReturnType<typeof verifyLuxartContractDocumentation>>;

interface AnonymousCandidateDependencies {
  helpProbe?: (options: { environment: Environment; now: Date }) => Promise<HelpEvidence>;
  contractVerifier?: (options: {
    origin: string;
    now: Date;
    timeoutMs: number;
  }) => Promise<ContractEvidence>;
}

interface AnonymousCandidateOptions extends AnonymousCandidateDependencies {
  environment?: Environment;
  now?: Date;
}

function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for the anonymous Luxart candidate check.`);
  return value;
}

export function loadAnonymousLuxartCandidateConfiguration(environment: Environment = process.env) {
  const helpUrl = required(environment, "LUXART_HELP_URL");
  const expectedPort = required(environment, "LUXART_EXPECTED_PORT");
  if (environment.LUXART_ALLOW_INSECURE_TEST_HTTP === "true") {
    throw new Error("Anonymous Luxart candidate verification requires HTTPS and refuses the HTTP override.");
  }

  const isolatedEnvironment = {
    LUXART_HELP_URL: helpUrl,
    LUXART_EXPECTED_PORT: expectedPort,
    LUXART_HELP_PROBE_TIMEOUT_MS: environment.LUXART_HELP_PROBE_TIMEOUT_MS,
    LUXART_ALLOW_INSECURE_TEST_HTTP: "false",
  } satisfies Environment;
  const help = loadLuxartHelpProbeConfiguration(isolatedEnvironment);
  if (help.transport !== "https") {
    throw new Error("Anonymous Luxart candidate verification requires HTTPS.");
  }

  return {
    origin: help.helpUrl.origin,
    expectedPort,
    timeoutMs: help.timeoutMs,
    targetFingerprintSha256: help.targetFingerprintSha256,
    isolatedEnvironment,
  };
}

function summarizeHelp(help: HelpEvidence) {
  return {
    ok: help.ok,
    reached: help.reached,
    classification: help.classification,
    httpStatus: help.httpStatus,
    bodySha256: help.bodySha256,
    directoryBrowsingChecked: help.directoryBrowsingChecked,
    directoryBrowsingDetected: help.directoryBrowsingDetected,
    candidateContract: help.candidateContract,
  };
}

function nextGateForHelp(help: HelpEvidence) {
  if (help.classification === "authentication_required") return "confirm_gateway_auth" as const;
  if (help.classification === "directory_listing_detected") return "fix_public_root" as const;
  return "fix_transport_or_route" as const;
}

export async function runAnonymousLuxartCandidateVerification({
  environment = process.env,
  now = new Date(),
  helpProbe = runLuxartHelpProbe,
  contractVerifier = ({ origin, now: checkedAt, timeoutMs }) => verifyLuxartContractDocumentation({
    origin,
    now: checkedAt,
    timeoutMs,
  }),
}: AnonymousCandidateOptions = {}) {
  const configuration = loadAnonymousLuxartCandidateConfiguration(environment);
  const help = await helpProbe({
    environment: configuration.isolatedEnvironment,
    now,
  });

  if (
    help.targetFingerprintSha256 !== configuration.targetFingerprintSha256 ||
    help.transport !== "https" ||
    help.port !== configuration.expectedPort
  ) {
    throw new Error("Anonymous Luxart Help evidence does not match the exact HTTPS candidate.");
  }

  const helpReady =
    help.ok === true &&
    help.reached === true &&
    help.classification === "ready" &&
    help.httpStatus === 200 &&
    /^[a-f0-9]{64}$/.test(help.bodySha256 ?? "") &&
    help.directoryBrowsingChecked === true &&
    help.directoryBrowsingDetected === false;

  if (!helpReady) {
    return {
      ok: false,
      checkedAt: now.toISOString(),
      stage: "anonymous_candidate" as const,
      targetFingerprintSha256: configuration.targetFingerprintSha256,
      transport: "https" as const,
      port: configuration.expectedPort,
      d1Eligible: false,
      nextGate: nextGateForHelp(help),
      credentialsAuthorized: false as const,
      launchAuthority: false as const,
      help: summarizeHelp(help),
      contract: { checked: false as const },
    };
  }

  const contract = await contractVerifier({
    origin: configuration.origin,
    now,
    timeoutMs: configuration.timeoutMs,
  });
  if (
    contract.checkedAt !== now.toISOString() ||
    contract.targetFingerprintSha256 !== configuration.targetFingerprintSha256
  ) {
    throw new Error("Anonymous Luxart contract evidence does not match the exact HTTPS candidate.");
  }

  const contractReady =
    contract.ok === true &&
    contract.expectedEndpointCount === luxartPublicContractEndpoints.length &&
    contract.verifiedEndpointCount === luxartPublicContractEndpoints.length &&
    contract.expectedSemanticContractSha256 === approvedLuxartReferenceSemanticContractSha256 &&
    contract.semanticContractSha256 === approvedLuxartReferenceSemanticContractSha256 &&
    contract.issues.length === 0;

  return {
    ok: contractReady,
    checkedAt: now.toISOString(),
    stage: "anonymous_candidate" as const,
    targetFingerprintSha256: configuration.targetFingerprintSha256,
    transport: "https" as const,
    port: configuration.expectedPort,
    d1Eligible: contractReady,
    nextGate: contractReady ? "luxart_d1" as const : "fix_contract" as const,
    credentialsAuthorized: false as const,
    launchAuthority: false as const,
    help: summarizeHelp(help),
    contract: {
      checked: true as const,
      ok: contract.ok,
      expectedEndpointCount: contract.expectedEndpointCount,
      verifiedEndpointCount: contract.verifiedEndpointCount,
      expectedSemanticContractSha256: contract.expectedSemanticContractSha256,
      semanticContractSha256: contract.semanticContractSha256,
      issues: contract.issues,
    },
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runAnonymousLuxartCandidateVerification()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        checkedAt: new Date().toISOString(),
        stage: "anonymous_candidate",
        d1Eligible: false,
        credentialsAuthorized: false,
        launchAuthority: false,
        error: error instanceof Error ? error.message : "Anonymous Luxart candidate verification failed.",
      }, null, 2));
      process.exitCode = 1;
    });
}
