import type { AnyRecord } from "node:dns";
import { resolveAny } from "node:dns/promises";
import { pathToFileURL } from "node:url";
import {
  normalizeProductionDnsRecords,
  productionDnsRecordSetSha256,
  readProductionDomainBaselineFile,
} from "./capture-production-domain-baseline";

type Environment = Record<string, string | undefined>;
type ResolveAnyLike = (hostname: string) => Promise<AnyRecord[]>;

interface VerificationOptions {
  environment?: Environment;
  now?: Date;
  resolveAnyImpl?: ResolveAnyLike;
}

function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export async function verifyProductionDomainBaseline({
  environment = process.env,
  now = new Date(),
  resolveAnyImpl = resolveAny,
}: VerificationOptions = {}) {
  if (!Number.isFinite(now.getTime())) throw new Error("Production DNS baseline verification time is invalid.");
  const stored = readProductionDomainBaselineFile(
    required(environment, "ZONE4YOU_DNS_BASELINE_EVIDENCE_PATH"),
  );
  const baselineCheckedAt = new Date(stored.evidence.checkedAt);
  const ageMs = now.getTime() - baselineCheckedAt.getTime();
  if (ageMs < -5 * 60_000 || ageMs > 24 * 3_600_000) {
    throw new Error("Production DNS baseline must be current and no more than 24 hours old.");
  }
  const expectedConfirmation = `VERIFY_ZONE4YOU_DNS_BASELINE:${stored.fileSha256}`;
  if (environment.ZONE4YOU_DNS_BASELINE_VERIFY_CONFIRMATION !== expectedConfirmation) {
    throw new Error(
      `ZONE4YOU_DNS_BASELINE_VERIFY_CONFIRMATION must exactly equal ${expectedConfirmation}.`,
    );
  }
  const currentRecords = normalizeProductionDnsRecords(await resolveAnyImpl(stored.evidence.hostname));
  const currentFingerprint = productionDnsRecordSetSha256(currentRecords);
  if (currentFingerprint !== stored.recordSetSha256) {
    throw new Error(
      "Production DNS changed after the rollback baseline was captured; stop cutover and capture a newly approved baseline.",
    );
  }
  return {
    ok: true,
    checkedAt: now.toISOString(),
    hostname: stored.evidence.hostname,
    baselineCheckedAt: baselineCheckedAt.toISOString(),
    recordCount: currentRecords.length,
    recordTypes: [...new Set(currentRecords.map((record) => record.type))].sort(),
    recordSetSha256: currentFingerprint,
    baselineFileSha256: stored.fileSha256,
    unchangedSinceCapture: true,
    rollbackReady: true,
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  verifyProductionDomainBaseline()
    .then((receipt) => console.log(JSON.stringify(receipt, null, 2)))
    .catch((error: unknown) => {
      console.error(
        `Production DNS baseline verification failed: ${error instanceof Error ? error.message : "Unknown error."}`,
      );
      process.exitCode = 1;
    });
}
