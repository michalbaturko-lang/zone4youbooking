import { createHash } from "node:crypto";
import { existsSync, lstatSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readStableReleaseJson } from "./release-evidence-file";

type Environment = Record<string, string | undefined>;
type FetchLike = (input: URL, init?: RequestInit) => Promise<Response>;

interface MemberzoneFallbackOptions {
  environment?: Environment;
  fetchImpl?: FetchLike;
  now?: Date;
  repositoryRoot?: string;
}

const repositoryRootDefault = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const maximumBodyBytes = 512 * 1024;
export const memberzoneFallbackUrl = new URL("https://memberzone.cz/zone4you/scheduler.aspx");

function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for Memberzone fallback verification.`);
  return value;
}

function timeoutMs(environment: Environment) {
  const parsed = Number(environment.ZONE4YOU_MEMBERZONE_TIMEOUT_MS ?? 10_000);
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 30_000) {
    throw new Error("ZONE4YOU_MEMBERZONE_TIMEOUT_MS must be an integer from 1000 to 30000.");
  }
  return parsed;
}

function outputTarget(raw: string, repositoryRoot: string) {
  const outputPath = resolve(raw);
  if (!outputPath.endsWith(".json")) {
    throw new Error("ZONE4YOU_MEMBERZONE_EVIDENCE_OUTPUT_PATH must end in .json.");
  }
  const fromRepository = relative(resolve(repositoryRoot), outputPath);
  if (fromRepository === "" || (!fromRepository.startsWith("..") && !isAbsolute(fromRepository))) {
    throw new Error("Memberzone fallback evidence must be stored outside the repository.");
  }
  if (existsSync(outputPath)) {
    throw new Error("Memberzone fallback evidence output already exists and will not be overwritten.");
  }
  const parent = lstatSync(dirname(outputPath));
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw new Error("Memberzone fallback evidence parent must be a real directory.");
  }
  if ((parent.mode & 0o077) !== 0) {
    throw new Error("Memberzone fallback evidence parent must not be accessible by group or other users.");
  }
  return outputPath;
}

async function readLimitedBody(response: Response) {
  const rawLength = response.headers.get("content-length");
  if (rawLength && Number(rawLength) > maximumBodyBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Memberzone fallback response is unexpectedly large.");
  }
  if (!response.body) return { body: "", bytes: 0 };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBodyBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Memberzone fallback response is unexpectedly large.");
      }
      body += decoder.decode(value, { stream: true });
    }
    return { body: body + decoder.decode(), bytes };
  } finally {
    reader.releaseLock();
  }
}

export async function verifyMemberzoneFallback({
  environment = process.env,
  fetchImpl = fetch,
  now = new Date(),
  repositoryRoot = repositoryRootDefault,
}: MemberzoneFallbackOptions = {}) {
  const outputPath = outputTarget(
    required(environment, "ZONE4YOU_MEMBERZONE_EVIDENCE_OUTPUT_PATH"),
    repositoryRoot,
  );
  const response = await fetchImpl(memberzoneFallbackUrl, {
    method: "GET",
    redirect: "manual",
    cache: "no-store",
    headers: { Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(timeoutMs(environment)),
  });
  if (response.status !== 200) {
    throw new Error(`Memberzone fallback returned unexpected HTTP status ${response.status}.`);
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "text/html") {
    throw new Error("Memberzone fallback did not return HTML.");
  }

  const { body, bytes } = await readLimitedBody(response);
  const schedulerDetected = /ASPxClientScheduler/i.test(body) && /\/ZONE4YOU\//i.test(body);
  const signInPathDetected = /Account\/SignIn\.aspx/i.test(body);
  const nonEmptyScheduleDetected = /['"]apts['"]\s*:\s*\[\s*\{/i.test(body);
  const reformerDetected = /REFORMER/i.test(body);
  if (!schedulerDetected || !signInPathDetected || !nonEmptyScheduleDetected || !reformerDetected) {
    throw new Error("Memberzone fallback does not expose the expected non-empty Zone4You schedule.");
  }

  const evidence = {
    schemaVersion: 1,
    ok: true,
    checkedAt: now.toISOString(),
    target: memberzoneFallbackUrl.href,
    targetFingerprintSha256: createHash("sha256").update(memberzoneFallbackUrl.href).digest("hex"),
    transport: "https",
    httpStatus: response.status,
    contentType,
    bodyBytes: bytes,
    bodySha256: createHash("sha256").update(body).digest("hex"),
    schedulerDetected,
    signInPathDetected,
    nonEmptyScheduleDetected,
    reformerDetected,
  } as const;
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  writeFileSync(outputPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const stored = readStableReleaseJson(outputPath, "Memberzone fallback evidence", {
    maximumBytes: 256 * 1024,
    ownerOnly: true,
  });
  if (!stored.bytes.equals(Buffer.from(serialized, "utf8"))) {
    throw new Error("Memberzone fallback evidence changed while it was being stored.");
  }
  if ((lstatSync(outputPath).mode & 0o777) !== 0o600) {
    throw new Error("Memberzone fallback evidence file permissions are not owner-only.");
  }

  return {
    ok: true,
    checkedAt: evidence.checkedAt,
    targetFingerprintSha256: evidence.targetFingerprintSha256,
    httpStatus: evidence.httpStatus,
    bodyBytes: evidence.bodyBytes,
    schedulerDetected: true,
    nonEmptyScheduleDetected: true,
    reformerDetected: true,
    evidenceSha256: stored.sha256,
    evidenceStoredOwnerOnly: true,
  } as const;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  verifyMemberzoneFallback()
    .then((receipt) => console.log(JSON.stringify(receipt, null, 2)))
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Memberzone fallback verification failed.",
      }, null, 2));
      process.exitCode = 1;
    });
}
