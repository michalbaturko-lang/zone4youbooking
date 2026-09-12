import { createHash } from "node:crypto";
import type { AnyRecord } from "node:dns";
import { resolve4, resolve6, resolveCname } from "node:dns/promises";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Environment = Record<string, string | undefined>;
type ResolveRecordsLike = (hostname: string) => Promise<AnyRecord[]>;
type ResolveAddressLike = (hostname: string) => Promise<Array<{ address: string; ttl: number }>>;
type ResolveCnameLike = (hostname: string) => Promise<string[]>;

interface ProductionDnsResolvers {
  resolve4Impl?: ResolveAddressLike;
  resolve6Impl?: ResolveAddressLike;
  resolveCnameImpl?: ResolveCnameLike;
}

export type ProductionDnsRollbackRecord =
  | { type: "A" | "AAAA"; address: string }
  | { type: "CNAME"; value: string };

export interface ProductionDomainBaselineEvidence {
  schemaVersion: 1;
  ok: true;
  checkedAt: string;
  hostname: string;
  records: ProductionDnsRollbackRecord[];
  recordSetSha256: string;
  rollbackReady: true;
}

interface CaptureOptions {
  environment?: Environment;
  now?: Date;
  repositoryRoot?: string;
  resolveRecordsImpl?: ResolveRecordsLike;
}

const productionHostname = "booking.zone4you.cz";
const repositoryRootDefault = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const maximumEvidenceBytes = 64 * 1024;

async function optionalDnsRecords<T>(request: Promise<T[]>): Promise<T[]> {
  try {
    return await request;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENODATA" || code === "ENOTFOUND") return [];
    throw error;
  }
}

export async function resolveProductionDnsRecords(
  targetHostname: string,
  {
    resolve4Impl = (value) => resolve4(value, { ttl: true }),
    resolve6Impl = (value) => resolve6(value, { ttl: true }),
    resolveCnameImpl = resolveCname,
  }: ProductionDnsResolvers = {},
): Promise<AnyRecord[]> {
  const [ipv4, ipv6, cnames] = await Promise.all([
    optionalDnsRecords(resolve4Impl(targetHostname)),
    optionalDnsRecords(resolve6Impl(targetHostname)),
    optionalDnsRecords(resolveCnameImpl(targetHostname)),
  ]);
  return [
    ...ipv4.map(({ address, ttl }) => ({ type: "A" as const, address, ttl })),
    ...ipv6.map(({ address, ttl }) => ({ type: "AAAA" as const, address, ttl })),
    ...cnames.map((value) => ({ type: "CNAME" as const, value })),
  ];
}

function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function normalizeProductionDnsRecords(records: AnyRecord[]): ProductionDnsRollbackRecord[] {
  const normalized: ProductionDnsRollbackRecord[] = [];
  for (const record of records) {
    const type = typeof record.type === "string" ? record.type.toUpperCase() : "";
    if (type === "A" || type === "AAAA") {
      const address = "address" in record && typeof record.address === "string" ? record.address : "";
      const expectedFamily = type === "A" ? 4 : 6;
      if (isIP(address) !== expectedFamily) {
        throw new Error(`Production DNS returned an invalid ${type} rollback record.`);
      }
      normalized.push({ type, address });
      continue;
    }
    if (type === "CNAME") {
      const value = "value" in record && typeof record.value === "string"
        ? record.value.trim().toLowerCase().replace(/\.$/, "")
        : "";
      const labels = value.split(".");
      if (
        !value ||
        value.length > 253 ||
        !labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
      ) {
        throw new Error("Production DNS returned an invalid CNAME rollback record.");
      }
      normalized.push({ type: "CNAME", value });
    }
  }
  const unique = new Map(normalized.map((record) => [stableJson(record), record]));
  const uniqueRecords = [...unique.values()];
  const configuredRecords = uniqueRecords.some((record) => record.type === "CNAME")
    ? uniqueRecords.filter((record) => record.type === "CNAME")
    : uniqueRecords;
  const result = configuredRecords.sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
  if (result.length === 0) {
    throw new Error("Production hostname has no A, AAAA or CNAME record to capture for rollback.");
  }
  return result;
}

export function productionDnsRecordSetSha256(records: ProductionDnsRollbackRecord[]) {
  return createHash("sha256").update(records.map(stableJson).sort().join("\n"), "utf8").digest("hex");
}

function protectedOutputPath(rawPath: string, repositoryRoot: string) {
  const outputPath = resolve(rawPath);
  if (!outputPath.endsWith(".json")) {
    throw new Error("ZONE4YOU_DNS_BASELINE_OUTPUT_PATH must end in .json.");
  }
  const fromRepository = relative(resolve(repositoryRoot), outputPath);
  if (fromRepository === "" || (!fromRepository.startsWith("..") && !isAbsolute(fromRepository))) {
    throw new Error("Production DNS rollback evidence must be stored outside the repository.");
  }
  if (existsSync(outputPath)) {
    throw new Error("Production DNS baseline already exists and will not be overwritten.");
  }
  const parent = lstatSync(dirname(outputPath));
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw new Error("Production DNS baseline parent must be a real directory.");
  }
  if ((parent.mode & 0o077) !== 0) {
    throw new Error("Production DNS baseline parent must not be accessible by group or other users.");
  }
  return outputPath;
}

export function loadProductionDomainBaselineCaptureConfig(
  environment: Environment = process.env,
  repositoryRoot = repositoryRootDefault,
) {
  const expectedConfirmation = `CAPTURE_ZONE4YOU_DNS_BASELINE:${productionHostname}`;
  if (environment.ZONE4YOU_DNS_BASELINE_CAPTURE_CONFIRMATION !== expectedConfirmation) {
    throw new Error(
      `ZONE4YOU_DNS_BASELINE_CAPTURE_CONFIRMATION must exactly equal ${expectedConfirmation}.`,
    );
  }
  return {
    hostname: productionHostname,
    outputPath: protectedOutputPath(
      required(environment, "ZONE4YOU_DNS_BASELINE_OUTPUT_PATH"),
      repositoryRoot,
    ),
  };
}

export function validateProductionDomainBaselineEvidence(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Production DNS baseline must be a JSON object.");
  }
  const evidence = value as Partial<ProductionDomainBaselineEvidence>;
  if (evidence.schemaVersion !== 1 || evidence.ok !== true || evidence.rollbackReady !== true) {
    throw new Error("Production DNS baseline is not a complete rollback artifact.");
  }
  if (evidence.hostname !== productionHostname) {
    throw new Error(`Production DNS baseline hostname must exactly equal ${productionHostname}.`);
  }
  const checkedAt = new Date(String(evidence.checkedAt ?? ""));
  if (!Number.isFinite(checkedAt.getTime())) {
    throw new Error("Production DNS baseline checkedAt must be a valid timestamp.");
  }
  if (!Array.isArray(evidence.records)) {
    throw new Error("Production DNS baseline records must be an array.");
  }
  const records = normalizeProductionDnsRecords(evidence.records as AnyRecord[]);
  const recordSetSha256 = productionDnsRecordSetSha256(records);
  if (evidence.recordSetSha256 !== recordSetSha256) {
    throw new Error("Production DNS baseline record-set SHA-256 does not match its rollback records.");
  }
  return {
    evidence: evidence as ProductionDomainBaselineEvidence,
    records,
    recordSetSha256,
  };
}

export function readProductionDomainBaselineFile(path: string) {
  const absolutePath = resolve(path);
  const stat = lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Production DNS baseline must be a regular file, not a symlink.");
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error("Production DNS baseline must not be accessible by group or other users.");
  }
  if (stat.size < 2 || stat.size > maximumEvidenceBytes) {
    throw new Error(`Production DNS baseline must contain between 2 and ${maximumEvidenceBytes} bytes.`);
  }
  const bytes = readFileSync(absolutePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Production DNS baseline is not valid JSON.");
  }
  return {
    ...validateProductionDomainBaselineEvidence(parsed),
    path: absolutePath,
    fileSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function captureProductionDomainBaseline({
  environment = process.env,
  now = new Date(),
  repositoryRoot = repositoryRootDefault,
  resolveRecordsImpl = resolveProductionDnsRecords,
}: CaptureOptions = {}) {
  const config = loadProductionDomainBaselineCaptureConfig(environment, repositoryRoot);
  if (!Number.isFinite(now.getTime())) throw new Error("Production DNS baseline time is invalid.");
  const records = normalizeProductionDnsRecords(await resolveRecordsImpl(config.hostname));
  const recordSetSha256 = productionDnsRecordSetSha256(records);
  const evidence: ProductionDomainBaselineEvidence = {
    schemaVersion: 1,
    ok: true,
    checkedAt: now.toISOString(),
    hostname: config.hostname,
    records,
    recordSetSha256,
    rollbackReady: true,
  };
  const body = `${JSON.stringify(evidence, null, 2)}\n`;
  writeFileSync(config.outputPath, body, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const stored = readProductionDomainBaselineFile(config.outputPath);
  if ((lstatSync(config.outputPath).mode & 0o777) !== 0o600) {
    throw new Error("Production DNS baseline file permissions are not owner-only.");
  }
  return {
    ok: true,
    checkedAt: evidence.checkedAt,
    hostname: config.hostname,
    recordCount: records.length,
    recordTypes: [...new Set(records.map((record) => record.type))].sort(),
    recordSetSha256,
    evidenceSha256: stored.fileSha256,
    evidenceStoredOwnerOnly: true,
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  captureProductionDomainBaseline()
    .then((receipt) => console.log(JSON.stringify(receipt, null, 2)))
    .catch((error: unknown) => {
      console.error(
        `Production DNS baseline capture failed: ${error instanceof Error ? error.message : "Unknown error."}`,
      );
      process.exitCode = 1;
    });
}
