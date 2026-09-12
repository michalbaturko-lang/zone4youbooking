import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

type Environment = Record<string, string | undefined>;
type FetchLike = (input: URL, init?: RequestInit) => Promise<Response>;

export type LuxartHelpProbeClassification =
  | "ready"
  | "authentication_required"
  | "redirect_rejected"
  | "soap_wcf_not_rest"
  | "directory_listing_detected"
  | "unexpected_response"
  | "network_unavailable";

export interface LuxartHelpProbeResult {
  ok: boolean;
  checkedAt: string;
  targetFingerprintSha256: string;
  transport: "https" | "approved_test_http";
  port: string;
  reached: boolean;
  classification: LuxartHelpProbeClassification;
  launchAuthority?: false;
  credentialsAuthorized?: false;
  httpStatus?: number;
  bodySha256?: string;
  networkCode?: string;
  candidateContract?: "soap_wcf" | "unknown";
  directoryBrowsingDetected?: boolean;
}

interface LuxartHelpProbeOptions {
  environment?: Environment;
  fetchImpl?: FetchLike;
  now?: Date;
}

const maximumHelpBodyBytes = 256 * 1024;

function positiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 30_000) {
    throw new Error("LUXART_HELP_PROBE_TIMEOUT_MS must be an integer from 1000 to 30000.");
  }
  return parsed;
}

export function loadLuxartHelpProbeConfiguration(environment: Environment = process.env) {
  const rawHelpUrl = environment.LUXART_HELP_URL?.trim();
  const rawBaseUrl = environment.LUXART_API_BASE_URL?.trim();
  if (!rawHelpUrl && !rawBaseUrl) {
    throw new Error("Set LUXART_HELP_URL or LUXART_API_BASE_URL before probing Luxart.");
  }

  const helpUrl = rawHelpUrl ? new URL(rawHelpUrl) : new URL("/Help", rawBaseUrl);
  if (helpUrl.username || helpUrl.password || helpUrl.search || helpUrl.hash) {
    throw new Error("Luxart Help URL must not contain credentials, query parameters or a fragment.");
  }
  if (!/^\/Help\/?$/i.test(helpUrl.pathname)) {
    throw new Error("LUXART_HELP_URL must point exactly to /Help.");
  }

  const allowInsecureHttp = environment.LUXART_ALLOW_INSECURE_TEST_HTTP === "true";
  if (helpUrl.protocol !== "https:" && !(helpUrl.protocol === "http:" && allowInsecureHttp)) {
    throw new Error("Luxart Help probe requires HTTPS. HTTP needs the explicit test-only override.");
  }

  const expectedPort = environment.LUXART_EXPECTED_PORT?.trim();
  if (expectedPort && (!/^\d{1,5}$/.test(expectedPort) || Number(expectedPort) > 65_535)) {
    throw new Error("LUXART_EXPECTED_PORT must be a valid TCP port.");
  }
  const effectivePort = helpUrl.port || (helpUrl.protocol === "https:" ? "443" : "80");
  if (expectedPort && effectivePort !== expectedPort) {
    throw new Error("Luxart Help URL does not use LUXART_EXPECTED_PORT.");
  }

  return {
    helpUrl,
    timeoutMs: positiveInteger(environment.LUXART_HELP_PROBE_TIMEOUT_MS, 8_000),
    transport: helpUrl.protocol === "https:" ? "https" as const : "approved_test_http" as const,
    port: effectivePort,
    targetFingerprintSha256: createHash("sha256").update(helpUrl.origin).digest("hex"),
  };
}

async function readLimitedText(response: Response) {
  const rawLength = response.headers.get("content-length");
  if (rawLength && Number(rawLength) > maximumHelpBodyBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Luxart Help response is unexpectedly large.");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumHelpBodyBytes) throw new Error("Luxart Help response is unexpectedly large.");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function readPublicCandidateDocument(
  url: URL,
  fetchImpl: FetchLike,
  signal: AbortSignal,
) {
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: { Accept: "text/html,application/wsdl+xml,application/xml,text/xml" },
      signal,
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    return await readLimitedText(response);
  } catch {
    return undefined;
  }
}

async function diagnoseUnexpectedCandidate(
  helpUrl: URL,
  fetchImpl: FetchLike,
  signal: AbortSignal,
) {
  const rootUrl = new URL("/", helpUrl.origin);
  const wsdlUrl = new URL("/Service1.svc?wsdl", helpUrl.origin);
  const [root, wsdl] = await Promise.all([
    readPublicCandidateDocument(rootUrl, fetchImpl, signal),
    readPublicCandidateDocument(wsdlUrl, fetchImpl, signal),
  ]);
  const directoryBrowsingDetected = Boolean(
    root &&
    /<title>[^<]*\s-\s\/\s*<\/title>/i.test(root) &&
    /href=["']\/(?:Web\.config|bin\/|App_Data\/)/i.test(root),
  );
  const soapWcfDetected = Boolean(
    wsdl &&
    /<(?:wsdl:)?definitions\b/i.test(wsdl) &&
    /<(?:wsdl:)?operation\b[^>]*\bname=["'][^"']+["']/i.test(wsdl),
  );

  return {
    classification: soapWcfDetected
      ? "soap_wcf_not_rest" as const
      : directoryBrowsingDetected
        ? "directory_listing_detected" as const
        : "unexpected_response" as const,
    candidateContract: soapWcfDetected ? "soap_wcf" as const : "unknown" as const,
    directoryBrowsingDetected,
  };
}

function safeNetworkCode(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return "TIMEOUT";
  if (error && typeof error === "object" && "cause" in error) {
    const cause = error.cause;
    if (cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string") {
      return /^[A-Z0-9_]+$/.test(cause.code) ? cause.code : "NETWORK_ERROR";
    }
  }
  return "NETWORK_ERROR";
}

export async function runLuxartHelpProbe({
  environment = process.env,
  fetchImpl = fetch,
  now = new Date(),
}: LuxartHelpProbeOptions = {}): Promise<LuxartHelpProbeResult> {
  const configuration = loadLuxartHelpProbeConfiguration(environment);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), configuration.timeoutMs);

  try {
    const response = await fetchImpl(configuration.helpUrl, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: { Accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
    });
    const base = {
      checkedAt: now.toISOString(),
      targetFingerprintSha256: configuration.targetFingerprintSha256,
      transport: configuration.transport,
      port: configuration.port,
      launchAuthority: false as const,
      credentialsAuthorized: false as const,
      reached: true,
      httpStatus: response.status,
    };

    if (response.status === 401 || response.status === 403) {
      return { ...base, ok: false, classification: "authentication_required" as const };
    }
    if (response.status >= 300 && response.status < 400) {
      return { ...base, ok: false, classification: "redirect_rejected" as const };
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      const candidate = await diagnoseUnexpectedCandidate(configuration.helpUrl, fetchImpl, controller.signal);
      return { ...base, ...candidate, ok: false };
    }

    const body = await readLimitedText(response);
    const looksLikeLuxartHelp = /<title>\s*API dokumentace\s*<\/title>/i.test(body) ||
      (/\/Help\/Api\//i.test(body) && /api\/(?:Lesson|Login|Reservations)/i.test(body));
    if (!looksLikeLuxartHelp) {
      const candidate = await diagnoseUnexpectedCandidate(configuration.helpUrl, fetchImpl, controller.signal);
      return { ...base, ...candidate, ok: false };
    }
    return {
      ...base,
      ok: true,
      classification: "ready" as const,
      bodySha256: createHash("sha256").update(body).digest("hex"),
    };
  } catch (error) {
    return {
      ok: false,
      checkedAt: now.toISOString(),
      targetFingerprintSha256: configuration.targetFingerprintSha256,
      transport: configuration.transport,
      port: configuration.port,
      launchAuthority: false as const,
      credentialsAuthorized: false as const,
      reached: false,
      classification: "network_unavailable" as const,
      networkCode: safeNetworkCode(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runLuxartHelpProbe()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        checkedAt: new Date().toISOString(),
        classification: "invalid_configuration",
        error: error instanceof Error ? error.message : "Luxart Help probe configuration failed.",
      }, null, 2));
      process.exitCode = 1;
    });
}
