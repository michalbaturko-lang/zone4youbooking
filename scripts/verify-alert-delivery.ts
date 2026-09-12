import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

type Environment = Record<string, string | undefined>;
type FetchLike = typeof fetch;

const placeholderSupportOwners = new Set([
  "-",
  "doplnit",
  "n a",
  "na",
  "none",
  "not assigned",
  "pending",
  "pending approval",
  "pending human approval",
  "placeholder",
  "tbd",
  "to be confirmed",
  "to be decided",
  "todo",
  "unassigned",
  "unknown",
]);

export interface AlertDeliveryConfig {
  appTarget: URL;
  webhookTarget: URL;
  supportOwner: string;
  bearerToken?: string;
  timeoutMs: number;
}

function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function operationalOwner(rawValue: string, name: string) {
  if (rawValue.length > 120) throw new Error(`${name} must contain at most 120 characters.`);
  if (/\p{Cc}/u.test(rawValue)) throw new Error(`${name} must not contain control characters.`);
  const normalized = rawValue
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[_./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (placeholderSupportOwners.has(normalized)) {
    throw new Error(`${name} must identify the actual support person or operational role.`);
  }
  return rawValue;
}

function secureUrl(rawValue: string, name: string, allowLocalHttp: boolean) {
  const value = new URL(rawValue);
  const local = ["localhost", "127.0.0.1", "::1"].includes(value.hostname);
  if (
    (value.protocol !== "https:" && !(local && allowLocalHttp)) ||
    value.username ||
    value.password ||
    value.hostname.endsWith(".invalid")
  ) {
    throw new Error(`${name} must use an approved HTTPS URL without embedded credentials.`);
  }
  return value;
}

export function alertTargetFingerprint(target: URL) {
  return createHash("sha256").update(target.toString(), "utf8").digest("hex").slice(0, 16);
}

export function loadAlertDeliveryConfig(environment: Environment = process.env): AlertDeliveryConfig {
  const allowLocalHttp = environment.ZONE4YOU_ALERT_ALLOW_LOCAL_HTTP === "true";
  const appTarget = secureUrl(required(environment, "ZONE4YOU_ALERT_APP_URL"), "ZONE4YOU_ALERT_APP_URL", allowLocalHttp);
  if (appTarget.pathname !== "/" || appTarget.search || appTarget.hash) {
    throw new Error("ZONE4YOU_ALERT_APP_URL must be a clean origin ending in /.");
  }
  const webhookTarget = secureUrl(
    required(environment, "ZONE4YOU_ALERT_WEBHOOK_URL"),
    "ZONE4YOU_ALERT_WEBHOOK_URL",
    allowLocalHttp,
  );
  const supportOwner = operationalOwner(
    required(environment, "ZONE4YOU_ALERT_SUPPORT_OWNER"),
    "ZONE4YOU_ALERT_SUPPORT_OWNER",
  );

  const expectedConfirmation = `SEND_ZONE4YOU_TEST_ALERT:${alertTargetFingerprint(webhookTarget)}`;
  if (environment.ZONE4YOU_ALERT_CONFIRMATION !== expectedConfirmation) {
    throw new Error(`ZONE4YOU_ALERT_CONFIRMATION must exactly equal ${expectedConfirmation}.`);
  }

  const timeoutMs = Number(environment.ZONE4YOU_ALERT_TIMEOUT_MS ?? "12000");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new Error("ZONE4YOU_ALERT_TIMEOUT_MS must be an integer between 1000 and 30000.");
  }

  return {
    appTarget,
    webhookTarget,
    supportOwner,
    bearerToken: environment.ZONE4YOU_ALERT_BEARER_TOKEN?.trim() || undefined,
    timeoutMs,
  };
}

export async function runAlertDeliveryTest(config: AlertDeliveryConfig, fetchImpl: FetchLike = fetch) {
  const startedAt = Date.now();
  const eventId = randomUUID();
  const payload = {
    schemaVersion: 1,
    event: "zone4you.pilot.test_alert",
    severity: "test",
    eventId,
    occurredAt: new Date().toISOString(),
    applicationOrigin: config.appTarget.origin,
    message: "Test doručení alertu Zone4You — není nutný zásah.",
  };
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "zone4you-pilot-alert-verifier/1",
  });
  if (config.bearerToken) headers.set("Authorization", `Bearer ${config.bearerToken}`);

  const response = await fetchImpl(config.webhookTarget, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(config.timeoutMs),
    headers,
    body: JSON.stringify(payload),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Alert target rejected the test event with HTTP ${response.status}.`);
  }

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    eventId,
    applicationOrigin: config.appTarget.origin,
    alertTargetFingerprint: alertTargetFingerprint(config.webhookTarget),
    supportOwnerConfigured: true,
    responseStatus: response.status,
    durationMs: Date.now() - startedAt,
    manualReceiptConfirmationRequired: true,
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runAlertDeliveryTest(loadAlertDeliveryConfig())
    .then((evidence) => console.log(JSON.stringify(evidence, null, 2)))
    .catch((error: unknown) => {
      console.error(`Alert delivery verification failed: ${error instanceof Error ? error.message : "Unknown error."}`);
      process.exitCode = 1;
    });
}
