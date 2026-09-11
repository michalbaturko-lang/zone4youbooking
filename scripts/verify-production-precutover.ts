import { pathToFileURL } from "node:url";
import { verifyPilotReleaseEvidence } from "./verify-pilot-release";
import { verifyProductionDomainBaseline } from "./verify-production-domain-baseline";

type Environment = Record<string, string | undefined>;
type ReleaseEvidence = ReturnType<typeof verifyPilotReleaseEvidence>;
type DnsEvidence = Awaited<ReturnType<typeof verifyProductionDomainBaseline>>;

interface PreCutoverOptions {
  environment?: Environment;
  now?: Date;
  releaseVerifier?: (environment: Environment, now: Date) => ReleaseEvidence;
  dnsVerifier?: (options: { environment: Environment; now: Date }) => Promise<DnsEvidence>;
}

function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export async function verifyProductionPreCutover({
  environment = process.env,
  now = new Date(),
  releaseVerifier = verifyPilotReleaseEvidence,
  dnsVerifier = verifyProductionDomainBaseline,
}: PreCutoverOptions = {}) {
  if (!Number.isFinite(now.getTime())) throw new Error("Pre-cutover verification time is invalid.");
  const dossierConfirmation = required(environment, "ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION");
  const dossierSha256 = dossierConfirmation.match(/^VERIFY_ZONE4YOU_RELEASE_DOSSIER:([a-f0-9]{64})$/)?.[1];
  if (!dossierSha256) {
    throw new Error("ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION must contain the exact dossier SHA-256.");
  }
  const expectedConfirmation = `VERIFY_ZONE4YOU_PRECUTOVER:${dossierSha256}`;
  if (environment.ZONE4YOU_PRECUTOVER_CONFIRMATION !== expectedConfirmation) {
    throw new Error(`ZONE4YOU_PRECUTOVER_CONFIRMATION must exactly equal ${expectedConfirmation}.`);
  }

  const release = releaseVerifier(environment, now);
  if (
    release.ok !== true ||
    release.conditions.explicitCutoverApproval !== true ||
    release.conditions.dnsRollbackBaselineReady !== true
  ) {
    throw new Error("Verified release evidence does not authorize the production DNS cutover.");
  }
  const dnsArtifact = release.artifacts.find((artifact) => artifact.name === "dnsRollbackBaseline");
  if (!dnsArtifact || !/^[a-f0-9]{64}$/.test(dnsArtifact.sha256)) {
    throw new Error("Verified release evidence is missing the exact DNS rollback baseline artifact.");
  }

  const dns = await dnsVerifier({
    environment: {
      ...environment,
      ZONE4YOU_DNS_BASELINE_EVIDENCE_PATH: required(
        environment,
        "ZONE4YOU_DNS_BASELINE_EVIDENCE_PATH",
      ),
      ZONE4YOU_DNS_BASELINE_VERIFY_CONFIRMATION:
        `VERIFY_ZONE4YOU_DNS_BASELINE:${dnsArtifact.sha256}`,
    },
    now,
  });
  if (
    dns.ok !== true ||
    dns.unchangedSinceCapture !== true ||
    dns.rollbackReady !== true ||
    dns.baselineFileSha256 !== dnsArtifact.sha256
  ) {
    throw new Error("Live production DNS does not match the approved rollback baseline artifact.");
  }

  return {
    ok: true,
    checkedAt: now.toISOString(),
    decision: "GO_TO_AUTHORIZED_DNS_CHANGE" as const,
    target: release.target,
    releaseId: release.releaseId,
    commit: release.commit,
    launchMode: release.launchMode,
    dossierSha256,
    dns: {
      hostname: dns.hostname,
      recordCount: dns.recordCount,
      recordTypes: dns.recordTypes,
      recordSetSha256: dns.recordSetSha256,
      baselineFileSha256: dns.baselineFileSha256,
      unchangedSinceCapture: true,
      rollbackReady: true,
    },
    explicitCutoverApproval: true,
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  verifyProductionPreCutover()
    .then((receipt) => console.log(JSON.stringify(receipt, null, 2)))
    .catch((error: unknown) => {
      console.error(
        `Production pre-cutover verification failed: ${error instanceof Error ? error.message : "Unknown error."}`,
      );
      process.exitCode = 1;
    });
}
