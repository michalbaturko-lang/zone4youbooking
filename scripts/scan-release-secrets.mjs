import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const maximumTextBytes = 1024 * 1024;
const knownExposedTokenDigests = new Set([
  "7e6e0aedcd89682014fa124e309cdbb74ac7917826404a6a8a89f49dec014da4",
  "ffe0f327f074cbb03f8aa14acefa6a69184c25cae5aacdc673b8563c8cb1176e",
  "08428467285068b426356b9b0d0ae1e80378d9137d5e559e5f8377dbd6dde29f",
]);
const binaryExtensions = new Set([
  ".avif", ".gif", ".ico", ".jpeg", ".jpg", ".mov", ".mp3", ".mp4", ".pdf", ".png",
  ".ttf", ".webm", ".webp", ".woff", ".woff2", ".zip",
]);

function git(repositoryRoot, args, options = {}) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: options.encoding ?? "utf8",
    input: options.input,
    maxBuffer: 32 * 1024 * 1024,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
}

function digestToken(value) {
  return createHash("sha256").update(value.toLowerCase(), "utf8").digest("hex");
}

function looksBinary(bytes) {
  return bytes.subarray(0, Math.min(bytes.length, 8192)).includes(0);
}

function scanText(text, path, source) {
  const issues = [];
  const candidates = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b[a-f0-9]{32}\b/gi) ?? [];
  if (candidates.some((candidate) => knownExposedTokenDigests.has(digestToken(candidate)))) {
    issues.push({ rule: "KNOWN_EXPOSED_LUXART_TEST_CREDENTIAL", path, source });
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
    issues.push({ rule: "PRIVATE_KEY_MATERIAL", path, source });
  }
  if (/\b(?:sk_live|rk_live|whsec)_[A-Za-z0-9]{16,}\b/.test(text)) {
    issues.push({ rule: "LIVE_PAYMENT_CREDENTIAL", path, source });
  }
  if (/\bgh[pousr]_[A-Za-z0-9]{30,}\b/.test(text)) {
    issues.push({ rule: "GITHUB_ACCESS_TOKEN", path, source });
  }
  if (/^\.env(?:\.|$)/.test(path.split("/").at(-1) ?? "")) {
    const secretAssignment = /^(?:LUXART_TEST_PASSWORD|LUXART_API_BASIC_PASSWORD|LUXART_API_BEARER_TOKEN|LUXART_API_AUTH_HEADER_VALUE|SESSION_SECRET|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|(?:BOOKING|PAYMENT|RATE_LIMIT)_DATABASE_URL)[ \t]*=[ \t]*(\S.*)$/m;
    if (secretAssignment.test(text)) {
      issues.push({ rule: "TRACKED_DOTENV_SECRET_VALUE", path, source });
    }
  }
  return issues;
}

function scanBytes(bytes, path, source) {
  if (looksBinary(bytes)) return [];
  if (bytes.length > maximumTextBytes) {
    if (binaryExtensions.has(extname(path).toLowerCase())) return [];
    return [{ rule: "OVERSIZED_TEXT_NOT_SCANNED", path, source }];
  }
  return scanText(bytes.toString("utf8"), path, source);
}

function currentFiles(repositoryRoot) {
  const output = git(repositoryRoot, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    encoding: "buffer",
  });
  return output.toString("utf8").split("\0").filter(Boolean);
}

function historyBlobEntries(repositoryRoot) {
  const rows = git(repositoryRoot, ["rev-list", "--objects", "--all"])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(" ");
      return {
        objectId: separator === -1 ? line : line.slice(0, separator),
        path: separator === -1 ? "" : line.slice(separator + 1),
      };
    });
  const ids = [...new Set(rows.map((row) => row.objectId))];
  if (ids.length === 0) return [];
  const metadata = new Map(
    git(repositoryRoot, ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], {
      input: `${ids.join("\n")}\n`,
    })
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [objectId, type, rawSize] = line.split(" ");
        return [objectId, { type, size: Number(rawSize) }];
      }),
  );
  const firstPath = new Map();
  for (const row of rows) {
    if (row.path && !firstPath.has(row.objectId)) firstPath.set(row.objectId, row.path);
  }
  return ids
    .filter((objectId) => metadata.get(objectId)?.type === "blob")
    .map((objectId) => ({
      objectId,
      path: firstPath.get(objectId) ?? "unknown-history-path",
      size: metadata.get(objectId)?.size ?? 0,
    }));
}

export function scanRepositorySecrets({ repositoryRoot = process.cwd(), includeHistory = true } = {}) {
  const root = realpathSync(resolve(repositoryRoot));
  const topLevel = realpathSync(git(root, ["rev-parse", "--show-toplevel"]).trim());
  if (topLevel !== root) {
    throw new Error("Secret scan must run from the exact Git repository root.");
  }
  const issues = [];
  const paths = currentFiles(root);
  for (const path of paths) {
    const absolutePath = resolve(root, path);
    const stat = lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    issues.push(...scanBytes(readFileSync(absolutePath), path, "working-tree"));
  }

  let historyBlobCount = 0;
  if (includeHistory) {
    for (const blob of historyBlobEntries(root)) {
      historyBlobCount += 1;
      if (blob.size > maximumTextBytes && binaryExtensions.has(extname(blob.path).toLowerCase())) continue;
      const bytes = git(root, ["cat-file", "blob", blob.objectId], { encoding: "buffer" });
      issues.push(...scanBytes(bytes, blob.path, `history:${blob.objectId.slice(0, 12)}`));
    }
  }

  const uniqueIssues = [...new Map(
    issues.map((issue) => [`${issue.rule}:${issue.path}:${issue.source}`, issue]),
  ).values()];
  return {
    ok: uniqueIssues.length === 0,
    checkedAt: new Date().toISOString(),
    currentFileCount: paths.length,
    historyBlobCount,
    historyIncluded: includeHistory,
    issues: uniqueIssues,
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  try {
    const result = scanRepositorySecrets();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`Release secret scan failed: ${error instanceof Error ? error.message : "Unknown error."}`);
    process.exitCode = 1;
  }
}
