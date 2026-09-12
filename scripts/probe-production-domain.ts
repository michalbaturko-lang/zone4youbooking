import type { AnyRecord } from "node:dns";
import { pathToFileURL } from "node:url";
import {
  normalizeProductionDnsRecords,
  productionDnsRecordSetSha256,
  resolveProductionDnsRecords,
} from "./capture-production-domain-baseline";

type Environment = Record<string, string | undefined>;
type ResolveRecordsLike = (hostname: string) => Promise<AnyRecord[]>;
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface ProbeOptions {
  environment?: Environment;
  now?: Date;
  resolveRecordsImpl?: ResolveRecordsLike;
  fetchImpl?: FetchLike;
}

const hostname = "booking.zone4you.cz";
const httpRoot = new URL(`http://${hostname}/`);
const httpsRoot = new URL(`https://${hostname}/`);
const healthUrl = new URL("/api/health", httpsRoot);

function timeoutFromEnvironment(environment: Environment) {
  const timeoutMs = Number(environment.ZONE4YOU_DOMAIN_PROBE_TIMEOUT_MS ?? "8000");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new Error("ZONE4YOU_DOMAIN_PROBE_TIMEOUT_MS must be an integer between 1000 and 30000.");
  }
  return timeoutMs;
}

function isExactHttpsRedirect(response: Response) {
  if (![301, 302, 307, 308].includes(response.status)) return false;
  const location = response.headers.get("location");
  if (!location) return false;
  try {
    const target = new URL(location, httpRoot);
    return target.origin === httpsRoot.origin && target.pathname === "/" && !target.search && !target.hash;
  } catch {
    return false;
  }
}

function securityHeaders(response: Response) {
  const hsts = response.headers.get("strict-transport-security") ?? "";
  const csp = response.headers.get("content-security-policy") ?? "";
  const hstsMaxAge = hsts.match(/(?:^|;)\s*max-age=(\d+)/i)?.[1];
  return {
    hsts: hstsMaxAge !== undefined && Number(hstsMaxAge) > 0,
    contentSecurityPolicy: csp.length > 0,
    frameAncestorsNone: /(?:^|;)\s*frame-ancestors\s+'none'\s*(?:;|$)/i.test(csp),
    noSniff: response.headers.get("x-content-type-options")?.toLowerCase() === "nosniff",
  };
}

async function requestHead(url: URL, timeoutMs: number, fetchImpl: FetchLike) {
  try {
    const response = await fetchImpl(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: "application/json",
        "User-Agent": "zone4you-production-domain-probe/1",
      },
    });
    return { reachable: true as const, response };
  } catch {
    return { reachable: false as const };
  }
}

export async function probeProductionDomain({
  environment = process.env,
  now = new Date(),
  resolveRecordsImpl = resolveProductionDnsRecords,
  fetchImpl = fetch,
}: ProbeOptions = {}) {
  if (!Number.isFinite(now.getTime())) throw new Error("Production domain probe time is invalid.");
  const timeoutMs = timeoutFromEnvironment(environment);
  const records = normalizeProductionDnsRecords(await resolveRecordsImpl(hostname));
  const recordTypes = [...new Set(records.map((record) => record.type))].sort();

  const http = await requestHead(httpRoot, timeoutMs, fetchImpl);
  const https = await requestHead(httpsRoot, timeoutMs, fetchImpl);
  const health = await requestHead(healthUrl, timeoutMs, fetchImpl);

  const httpResult = http.reachable
    ? { reachable: true, status: http.response.status, redirectsToExactHttps: isExactHttpsRedirect(http.response) }
    : { reachable: false, status: null, redirectsToExactHttps: false };
  const httpsResult = https.reachable
    ? { reachable: true, status: https.response.status, ...securityHeaders(https.response) }
    : {
        reachable: false,
        status: null,
        hsts: false,
        contentSecurityPolicy: false,
        frameAncestorsNone: false,
        noSniff: false,
      };
  const healthResult = health.reachable
    ? {
        reachable: true,
        status: health.response.status,
        jsonContentType: (health.response.headers.get("content-type") ?? "").toLowerCase().includes("application/json"),
      }
    : { reachable: false, status: null, jsonContentType: false };

  const candidateReady =
    httpResult.redirectsToExactHttps &&
    httpsResult.status === 200 &&
    httpsResult.hsts &&
    httpsResult.contentSecurityPolicy &&
    httpsResult.frameAncestorsNone &&
    httpsResult.noSniff &&
    healthResult.status === 200 &&
    healthResult.jsonContentType;

  return {
    schemaVersion: 1,
    ok: true,
    checkedAt: now.toISOString(),
    hostname,
    dns: {
      recordCount: records.length,
      recordTypes,
      recordSetSha256: productionDnsRecordSetSha256(records),
    },
    http: httpResult,
    https: httpsResult,
    health: healthResult,
    status: candidateReady ? "candidate_ready" as const : "not_ready" as const,
    authorizesCutover: false as const,
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  probeProductionDomain()
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error: unknown) => {
      console.error(`Production domain probe failed: ${error instanceof Error ? error.message : "Unknown error."}`);
      process.exitCode = 1;
    });
}
