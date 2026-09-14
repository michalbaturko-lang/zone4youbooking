import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readStableReleaseJson } from "./release-evidence-file";

type Environment = Record<string, string | undefined>;

export interface ReadonlyRollbackTimerEvidence {
  schemaVersion: 1;
  ok: true;
  checkedAt: string;
  startedAt: string;
  target: string;
  commit: string;
  maximumDurationMs: number;
  drillId: string;
}

interface CaptureOptions {
  environment?: Environment;
  now?: Date;
  repositoryRoot?: string;
}

const repositoryRootDefault = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const maximumEvidenceBytes = 16 * 1024;

function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function cleanTarget(rawValue: string, allowLocalHttp: boolean) {
  const target = new URL(rawValue);
  const local = ["localhost", "127.0.0.1", "::1"].includes(target.hostname);
  if (
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash ||
    (target.protocol !== "https:" && !(local && allowLocalHttp))
  ) {
    throw new Error("ZONE4YOU_ROLLBACK_APP_URL must be a clean HTTPS origin without credentials, query or hash.");
  }
  return target;
}

function fullCommit(rawValue: string) {
  const commit = rawValue.toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error("ZONE4YOU_ROLLBACK_EXPECTED_COMMIT must be a full 40-character Git SHA.");
  }
  return commit;
}

function maximumDuration(environment: Environment) {
  const seconds = Number(environment.ZONE4YOU_ROLLBACK_MAX_SECONDS ?? "300");
  if (!Number.isSafeInteger(seconds) || seconds < 10 || seconds > 300) {
    throw new Error("ZONE4YOU_ROLLBACK_MAX_SECONDS must be an integer between 10 and 300.");
  }
  return seconds * 1_000;
}

export function readonlyRollbackTimerFingerprint(target: URL, commit: string, maximumDurationMs: number) {
  return createHash("sha256")
    .update(`${target.origin}\n${commit}\n${maximumDurationMs}`, "utf8")
    .digest("hex")
    .slice(0, 16);
}

function protectedOutputPath(rawPath: string, repositoryRoot: string) {
  const outputPath = resolve(rawPath);
  if (!outputPath.endsWith(".json")) {
    throw new Error("ZONE4YOU_ROLLBACK_TIMER_OUTPUT_PATH must end in .json.");
  }
  const fromRepository = relative(resolve(repositoryRoot), outputPath);
  if (fromRepository === "" || (!fromRepository.startsWith("..") && !isAbsolute(fromRepository))) {
    throw new Error("Rollback timer evidence must be stored outside the repository.");
  }
  if (existsSync(outputPath)) {
    throw new Error("Rollback timer evidence already exists and will not be overwritten.");
  }
  const parent = lstatSync(dirname(outputPath));
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw new Error("Rollback timer evidence parent must be a real directory.");
  }
  if ((parent.mode & 0o077) !== 0) {
    throw new Error("Rollback timer evidence parent must not be accessible by group or other users.");
  }
  return outputPath;
}

export function validateReadonlyRollbackTimerEvidence(value: unknown): ReadonlyRollbackTimerEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Rollback timer evidence must be a JSON object.");
  }
  const evidence = value as Partial<ReadonlyRollbackTimerEvidence>;
  if (evidence.schemaVersion !== 1 || evidence.ok !== true) {
    throw new Error("Rollback timer evidence is not a complete start artifact.");
  }
  const target = cleanTarget(String(evidence.target ?? ""), false);
  const commit = fullCommit(String(evidence.commit ?? ""));
  const startedAt = new Date(String(evidence.startedAt ?? ""));
  if (!Number.isFinite(startedAt.getTime()) || evidence.checkedAt !== evidence.startedAt) {
    throw new Error("Rollback timer checkedAt and startedAt must be the same valid timestamp.");
  }
  if (
    !Number.isSafeInteger(evidence.maximumDurationMs) ||
    evidence.maximumDurationMs! < 10_000 ||
    evidence.maximumDurationMs! > 300_000
  ) {
    throw new Error("Rollback timer maximumDurationMs must be between 10000 and 300000.");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    String(evidence.drillId ?? ""),
  )) {
    throw new Error("Rollback timer drillId must be a UUIDv4.");
  }
  return {
    schemaVersion: 1,
    ok: true,
    checkedAt: startedAt.toISOString(),
    startedAt: startedAt.toISOString(),
    target: target.origin,
    commit,
    maximumDurationMs: evidence.maximumDurationMs!,
    drillId: evidence.drillId!,
  };
}

export function readReadonlyRollbackTimerFile(path: string) {
  const absolutePath = resolve(path);
  const loaded = readStableReleaseJson(absolutePath, "Rollback timer evidence", {
    maximumBytes: maximumEvidenceBytes,
    ownerOnly: true,
  });
  return {
    evidence: validateReadonlyRollbackTimerEvidence(loaded.data),
    path: absolutePath,
    fileSha256: loaded.sha256,
  };
}

export function loadReadonlyRollbackTimerCaptureConfig(
  environment: Environment = process.env,
  repositoryRoot = repositoryRootDefault,
) {
  const target = cleanTarget(
    required(environment, "ZONE4YOU_ROLLBACK_APP_URL"),
    environment.ZONE4YOU_ROLLBACK_ALLOW_LOCAL_HTTP === "true",
  );
  const commit = fullCommit(required(environment, "ZONE4YOU_ROLLBACK_EXPECTED_COMMIT"));
  const maximumDurationMs = maximumDuration(environment);
  const expectedConfirmation = `START_ZONE4YOU_READ_ONLY_ROLLBACK:${readonlyRollbackTimerFingerprint(
    target,
    commit,
    maximumDurationMs,
  )}`;
  if (environment.ZONE4YOU_ROLLBACK_TIMER_CAPTURE_CONFIRMATION !== expectedConfirmation) {
    throw new Error(`ZONE4YOU_ROLLBACK_TIMER_CAPTURE_CONFIRMATION must exactly equal ${expectedConfirmation}.`);
  }
  return {
    target,
    commit,
    maximumDurationMs,
    outputPath: protectedOutputPath(
      required(environment, "ZONE4YOU_ROLLBACK_TIMER_OUTPUT_PATH"),
      repositoryRoot,
    ),
  };
}

export function captureReadonlyRollbackTimer({
  environment = process.env,
  now = new Date(),
  repositoryRoot = repositoryRootDefault,
}: CaptureOptions = {}) {
  const config = loadReadonlyRollbackTimerCaptureConfig(environment, repositoryRoot);
  if (!Number.isFinite(now.getTime())) throw new Error("Rollback timer start time is invalid.");
  const evidence: ReadonlyRollbackTimerEvidence = {
    schemaVersion: 1,
    ok: true,
    checkedAt: now.toISOString(),
    startedAt: now.toISOString(),
    target: config.target.origin,
    commit: config.commit,
    maximumDurationMs: config.maximumDurationMs,
    drillId: randomUUID(),
  };
  const body = `${JSON.stringify(evidence, null, 2)}\n`;
  writeFileSync(config.outputPath, body, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const stored = readReadonlyRollbackTimerFile(config.outputPath);
  const expectedSha256 = createHash("sha256").update(body, "utf8").digest("hex");
  if (stored.fileSha256 !== expectedSha256) {
    throw new Error("Rollback timer evidence changed while it was being stored.");
  }
  if ((lstatSync(config.outputPath).mode & 0o777) !== 0o600) {
    throw new Error("Rollback timer evidence file permissions are not owner-only.");
  }
  return {
    ok: true,
    checkedAt: evidence.checkedAt,
    drillId: evidence.drillId,
    maximumDurationMs: evidence.maximumDurationMs,
    evidenceSha256: stored.fileSha256,
    evidenceStoredOwnerOnly: true,
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  try {
    console.log(JSON.stringify(captureReadonlyRollbackTimer(), null, 2));
  } catch (error) {
    console.error(`Rollback timer capture failed: ${error instanceof Error ? error.message : "Unknown error."}`);
    process.exitCode = 1;
  }
}
