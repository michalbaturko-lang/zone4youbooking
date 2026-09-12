import { createHash } from "node:crypto";
import { statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readStableReleaseJson } from "./release-evidence-file";
import { assertSupportedLuxartApiContract } from "../src/lib/luxartApiContract";

type Environment = Record<string, string | undefined>;
type JsonObject = Record<string, unknown>;

const productionTarget = "https://booking.zone4you.cz";
const maximumJsonBytes = 256 * 1024;

function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function cleanHttpsOrigin(rawValue: string, name: string) {
  const value = new URL(rawValue);
  if (
    value.protocol !== "https:" ||
    value.username ||
    value.password ||
    value.pathname !== "/" ||
    value.search ||
    value.hash ||
    value.hostname.endsWith(".invalid")
  ) {
    throw new Error(`${name} must be a clean approved HTTPS origin.`);
  }
  return value.origin;
}

function timestamp(rawValue: string, name: string) {
  const value = new Date(rawValue);
  if (!Number.isFinite(value.getTime())) throw new Error(`${name} must be a valid timestamp.`);
  return value;
}

function boundedInteger(environment: Environment, name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(environment[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function evidenceFile(rawPath: string, label: string, ownerOnly = false) {
  const path = resolve(rawPath);
  const loaded = readStableReleaseJson(path, label, { maximumBytes: maximumJsonBytes, ownerOnly });
  const parsed = loaded.data;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  const data = parsed as JsonObject;
  if (data.ok !== true) throw new Error(`${label}.ok must be true before it can enter a release dossier.`);
  timestamp(String(data.checkedAt ?? ""), `${label}.checkedAt`);
  return {
    data,
    reference: {
      path,
      sha256: loaded.sha256,
    },
  };
}

export function buildPilotReleaseDossier(environment: Environment = process.env) {
  const commit = required(environment, "ZONE4YOU_RELEASE_COMMIT").toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("ZONE4YOU_RELEASE_COMMIT must be a full 40-character Git SHA.");
  const launchMode = required(environment, "ZONE4YOU_DEPLOYMENT_PHASE");
  if (!(["booking_without_payments", "booking_with_stripe"] as string[]).includes(launchMode)) {
    throw new Error("ZONE4YOU_DEPLOYMENT_PHASE must be booking_without_payments or booking_with_stripe.");
  }
  const stagingTarget = cleanHttpsOrigin(
    required(environment, "ZONE4YOU_STAGING_APP_ORIGIN"),
    "ZONE4YOU_STAGING_APP_ORIGIN",
  );
  if (stagingTarget === productionTarget) throw new Error("ZONE4YOU_STAGING_APP_ORIGIN must not be production.");
  const luxartOrigin = cleanHttpsOrigin(required(environment, "LUXART_API_BASE_URL"), "LUXART_API_BASE_URL");
  const luxartApiContract = assertSupportedLuxartApiContract(environment);
  const startsAt = timestamp(required(environment, "ZONE4YOU_RELEASE_WINDOW_STARTS_AT"), "ZONE4YOU_RELEASE_WINDOW_STARTS_AT");
  const endsAt = timestamp(required(environment, "ZONE4YOU_RELEASE_WINDOW_ENDS_AT"), "ZONE4YOU_RELEASE_WINDOW_ENDS_AT");
  if (endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > 24 * 3_600_000) {
    throw new Error("Release window must be increasing and no longer than 24 hours.");
  }

  const files = {
    luxartReadOnly: evidenceFile(required(environment, "ZONE4YOU_LUXART_EVIDENCE_PATH"), "Luxart evidence"),
    runtimeProbe: evidenceFile(required(environment, "ZONE4YOU_RUNTIME_EVIDENCE_PATH"), "runtime evidence"),
    bookingMutationUat: evidenceFile(required(environment, "ZONE4YOU_BOOKING_UAT_EVIDENCE_PATH"), "booking UAT evidence"),
    rollback: evidenceFile(required(environment, "ZONE4YOU_ROLLBACK_EVIDENCE_PATH"), "rollback evidence"),
    dnsRollbackBaseline: evidenceFile(
      required(environment, "ZONE4YOU_DNS_BASELINE_EVIDENCE_PATH"),
      "DNS rollback baseline evidence",
      true,
    ),
    alertDelivery: evidenceFile(required(environment, "ZONE4YOU_ALERT_EVIDENCE_PATH"), "alert evidence"),
    memberzoneFallback: evidenceFile(
      required(environment, "ZONE4YOU_MEMBERZONE_FALLBACK_EVIDENCE_PATH"),
      "Memberzone fallback evidence",
      true,
    ),
  };
  const artifacts: Record<string, { path: string; sha256: string }> = Object.fromEntries(
    Object.entries(files).map(([name, file]) => [name, file.reference]),
  );
  if (launchMode === "booking_with_stripe") {
    artifacts.stripeUat = evidenceFile(
      required(environment, "ZONE4YOU_STRIPE_UAT_EVIDENCE_PATH"),
      "Stripe UAT evidence",
    ).reference;
  }
  const alertEventId = files.alertDelivery.data.eventId;
  if (typeof alertEventId !== "string" || !alertEventId.trim()) {
    throw new Error("Alert evidence must contain a non-empty eventId.");
  }
  const pendingAt = startsAt.toISOString();

  return {
    schemaVersion: 5,
    draft: true,
    releaseId: required(environment, "ZONE4YOU_RELEASE_ID"),
    target: `${productionTarget}/`,
    stagingTarget: `${stagingTarget}/`,
    luxartOrigin: `${luxartOrigin}/`,
    luxartApiContract,
    commit,
    launchMode,
    maximumEvidenceAgeHours: boundedInteger(
      environment,
      "ZONE4YOU_RELEASE_MAXIMUM_EVIDENCE_AGE_HOURS",
      72,
      1,
      168,
    ),
    launchWindow: {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    },
    artifacts,
    approvals: {
      uat: {
        decision: "NO-GO",
        openP0: 0,
        openP1: 0,
        approvedBy: "pending-human-approval",
        approvedAt: pendingAt,
      },
      alertReceipt: {
        confirmed: false,
        eventId: alertEventId.trim(),
        approvedBy: "pending-human-approval",
        approvedAt: pendingAt,
      },
      memberzoneFallback: {
        available: false,
        approvedBy: "pending-human-approval",
        approvedAt: pendingAt,
      },
      luxartNotifications: {
        confirmed: false,
        approvedBy: "pending-human-approval",
        approvedAt: pendingAt,
      },
      cutover: {
        approved: false,
        approvedBy: "pending-human-approval",
        approvedAt: pendingAt,
      },
    },
  };
}

export function writePilotReleaseDossier(environment: Environment = process.env) {
  const outputPath = resolve(required(environment, "ZONE4YOU_RELEASE_DOSSIER_OUTPUT_PATH"));
  if (!outputPath.endsWith(".json")) throw new Error("ZONE4YOU_RELEASE_DOSSIER_OUTPUT_PATH must end in .json.");
  if (!statSync(dirname(outputPath)).isDirectory()) {
    throw new Error("ZONE4YOU_RELEASE_DOSSIER_OUTPUT_PATH parent must already be a directory.");
  }
  const dossier = buildPilotReleaseDossier(environment);
  const body = `${JSON.stringify(dossier, null, 2)}\n`;
  writeFileSync(outputPath, body, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    releaseId: dossier.releaseId,
    draft: true,
    dossierSha256: createHash("sha256").update(body, "utf8").digest("hex"),
    artifactCount: Object.keys(dossier.artifacts).length,
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  try {
    console.log(JSON.stringify(writePilotReleaseDossier(), null, 2));
  } catch (error) {
    console.error(`Pilot release dossier preparation failed: ${error instanceof Error ? error.message : "Unknown error."}`);
    process.exitCode = 1;
  }
}
