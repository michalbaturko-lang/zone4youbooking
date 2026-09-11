import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertConfirmedLuxartGatewayAuth, type LuxartGatewayAuthMode } from "../src/lib/luxartGatewayAuth";
import { parseLuxartResourceMapping } from "../src/lib/luxartMappings";
import { bookingRules } from "../src/lib/bookingRules";
import { rateLimitRuntimeReady } from "../src/lib/rateLimit";
import { zone4YouDateKey, zone4YouScheduleRange, zone4YouTimeZone } from "../src/lib/zone4YouTime";
import { validateProductionDomainBaselineEvidence } from "./capture-production-domain-baseline";

type Environment = Record<string, string | undefined>;
type JsonObject = Record<string, unknown>;

interface JsonEvidenceFile {
  data: JsonObject;
  sha256: string;
}

const maximumJsonBytes = 256 * 1024;
const productionOrigin = "https://booking.zone4you.cz";

function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function objectValue(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonObject;
}

function stringValue(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function trueValue(value: unknown, label: string) {
  if (value !== true) throw new Error(`${label} must be true.`);
}

function falseValue(value: unknown, label: string) {
  if (value !== false) throw new Error(`${label} must be false.`);
}

function integerValue(value: unknown, label: string, minimum = 0) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}.`);
  }
  return Number(value);
}

function stringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  return value as string[];
}

function cleanHttpsOrigin(value: unknown, label: string) {
  const raw = stringValue(value, label);
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.hostname.endsWith(".invalid")
  ) {
    throw new Error(`${label} must be a clean approved HTTPS origin.`);
  }
  return url.origin;
}

function readBoundedJson(path: string, label: string): JsonEvidenceFile {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file, not a symlink.`);
  if (stat.size < 2 || stat.size > maximumJsonBytes) {
    throw new Error(`${label} must contain between 2 and ${maximumJsonBytes} bytes.`);
  }
  const bytes = readFileSync(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  return {
    data: objectValue(parsed, label),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function checkedAt(value: unknown, label: string, now: Date, maximumAgeHours: number) {
  const timestamp = new Date(stringValue(value, `${label}.checkedAt`));
  const time = timestamp.getTime();
  if (!Number.isFinite(time)) throw new Error(`${label}.checkedAt must be a valid timestamp.`);
  const driftMs = time - now.getTime();
  if (driftMs > 5 * 60_000) throw new Error(`${label} evidence is dated in the future.`);
  if (now.getTime() - time > maximumAgeHours * 3_600_000) {
    throw new Error(`${label} evidence is older than ${maximumAgeHours} hours.`);
  }
  return timestamp.toISOString();
}

function approvedAt(value: unknown, label: string, now: Date, maximumAgeHours: number) {
  const timestamp = new Date(stringValue(value, `${label}.approvedAt`));
  const time = timestamp.getTime();
  if (!Number.isFinite(time)) throw new Error(`${label}.approvedAt must be a valid timestamp.`);
  if (time - now.getTime() > 5 * 60_000) throw new Error(`${label} approval is dated in the future.`);
  if (now.getTime() - time > maximumAgeHours * 3_600_000) {
    throw new Error(`${label} approval is older than ${maximumAgeHours} hours.`);
  }
  return timestamp.toISOString();
}

function artifact(
  dossierDirectory: string,
  artifacts: JsonObject,
  name: string,
  now: Date,
  maximumAgeHours: number,
) {
  const reference = objectValue(artifacts[name], `artifacts.${name}`);
  const configuredPath = stringValue(reference.path, `artifacts.${name}.path`);
  const path = isAbsolute(configuredPath) ? configuredPath : resolve(dossierDirectory, configuredPath);
  const expectedSha256 = stringValue(reference.sha256, `artifacts.${name}.sha256`).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error(`artifacts.${name}.sha256 must be a full SHA-256 digest.`);
  }
  const loaded = readBoundedJson(path, `artifacts.${name}`);
  if (loaded.sha256 !== expectedSha256) throw new Error(`artifacts.${name} SHA-256 does not match the dossier.`);
  trueValue(loaded.data.ok, `artifacts.${name}.ok`);
  checkedAt(loaded.data.checkedAt, `artifacts.${name}`, now, maximumAgeHours);
  return { ...loaded, path };
}

function exactString(value: unknown, expected: string, label: string) {
  if (value !== expected) throw new Error(`${label} must exactly equal ${expected}.`);
}

function validateScheduleRange(evidence: JsonObject, label: string) {
  const range = objectValue(evidence.range, `${label}.range`);
  const evidenceCheckedAt = new Date(stringValue(evidence.checkedAt, `${label}.checkedAt`));
  if (!Number.isFinite(evidenceCheckedAt.getTime())) throw new Error(`${label}.checkedAt must be a valid timestamp.`);
  const expected = zone4YouScheduleRange(evidenceCheckedAt, bookingRules.scheduleDays);
  exactString(range.from, expected.from, `${label}.range.from`);
  exactString(range.to, expected.to, `${label}.range.to`);
  exactString(range.timeZone, zone4YouTimeZone, `${label}.range.timeZone`);
  if (integerValue(range.days, `${label}.range.days`, 1) !== bookingRules.scheduleDays) {
    throw new Error(`${label}.range.days must exactly equal ${bookingRules.scheduleDays}.`);
  }
  return expected;
}

function validateLessonRangeEvidence(
  evidence: JsonObject,
  range: { from: string; to: string },
  label: string,
) {
  const earliest = new Date(stringValue(evidence.earliestStartsAt, `${label}.earliestStartsAt`));
  const latest = new Date(stringValue(evidence.latestStartsAt, `${label}.latestStartsAt`));
  if (!Number.isFinite(earliest.getTime()) || !Number.isFinite(latest.getTime()) || latest < earliest) {
    throw new Error(`${label} must contain valid increasing lesson bounds.`);
  }
  const dateKeys = stringArray(evidence.dateKeys, `${label}.dateKeys`);
  const sortedUniqueDateKeys = [...new Set(dateKeys)].sort();
  if (JSON.stringify(dateKeys) !== JSON.stringify(sortedUniqueDateKeys)) {
    throw new Error(`${label}.dateKeys must be unique and sorted.`);
  }
  const fromDay = range.from.slice(0, 10);
  const toDay = range.to.slice(0, 10);
  if (dateKeys.some((dayKey) => !/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || dayKey < fromDay || dayKey >= toDay)) {
    throw new Error(`${label} contains a lesson day outside the approved seven-day Prague range.`);
  }
  if (zone4YouDateKey(earliest) !== dateKeys[0] || zone4YouDateKey(latest) !== dateKeys.at(-1)) {
    throw new Error(`${label} lesson bounds do not match its Prague date keys.`);
  }
  return { earliest: earliest.toISOString(), latest: latest.toISOString(), dateKeys };
}

function requireApproval(
  approvals: JsonObject,
  name: string,
  now: Date,
  maximumAgeHours: number,
) {
  const approval = objectValue(approvals[name], `approvals.${name}`);
  const approvedBy = stringValue(approval.approvedBy, `approvals.${name}.approvedBy`);
  if (approvedBy.length > 120) throw new Error(`approvals.${name}.approvedBy must contain at most 120 characters.`);
  if (approvedBy === "pending-human-approval") {
    throw new Error(`approvals.${name}.approvedBy must identify the actual approving person or role.`);
  }
  approvedAt(approval.approvedAt, `approvals.${name}`, now, maximumAgeHours);
  return approval;
}

function roomMap(environment: Environment) {
  const mapping = parseLuxartResourceMapping(required(environment, "LUXART_RESOURCE_MAP_JSON"));
  return new Map(Object.entries(mapping));
}

export function validateLuxartEvidence(
  evidence: JsonObject,
  expectedLuxartOrigin: string,
  resourceMap: Map<string, number>,
  gatewayAuthMode: LuxartGatewayAuthMode,
) {
  exactString(cleanHttpsOrigin(evidence.target, "artifacts.luxartReadOnly.target"), expectedLuxartOrigin, "Luxart evidence target");
  exactString(evidence.gatewayAuthMode, gatewayAuthMode, "Luxart evidence gatewayAuthMode");
  const range = validateScheduleRange(evidence, "artifacts.luxartReadOnly");
  const czech = objectValue(evidence.czech, "artifacts.luxartReadOnly.czech");
  const english = objectValue(evidence.english, "artifacts.luxartReadOnly.english");
  const count = integerValue(czech.count, "artifacts.luxartReadOnly.czech.count", 1);
  if (integerValue(english.count, "artifacts.luxartReadOnly.english.count", 1) !== count) {
    throw new Error("Czech and English Luxart evidence counts differ.");
  }
  const occurrenceSha = stringValue(czech.occurrenceSetSha256, "Luxart Czech occurrence digest");
  if (!/^[a-f0-9]{64}$/.test(occurrenceSha) || english.occurrenceSetSha256 !== occurrenceSha) {
    throw new Error("Czech and English Luxart occurrence digests must be the same full SHA-256.");
  }
  const reformer = integerValue(czech.reformer, "artifacts.luxartReadOnly.czech.reformer", 1);
  if (integerValue(english.reformer, "artifacts.luxartReadOnly.english.reformer", 1) !== reformer) {
    throw new Error("Czech and English Reformer counts differ.");
  }
  const czechRange = validateLessonRangeEvidence(czech, range, "artifacts.luxartReadOnly.czech");
  const englishRange = validateLessonRangeEvidence(english, range, "artifacts.luxartReadOnly.english");
  if (JSON.stringify(czechRange) !== JSON.stringify(englishRange)) {
    throw new Error("Czech and English Luxart lesson ranges differ.");
  }
  if (!Array.isArray(czech.roomNumbers) || czech.roomNumbers.length === 0) {
    throw new Error("Luxart evidence must contain observed room numbers.");
  }
  const observedRooms = czech.roomNumbers.map((room, index) =>
    integerValue(room, `artifacts.luxartReadOnly.czech.roomNumbers[${index}]`, 1),
  );
  const englishRooms = Array.isArray(english.roomNumbers) ? english.roomNumbers.map(Number).sort((a, b) => a - b) : [];
  if (JSON.stringify([...observedRooms].sort((a, b) => a - b)) !== JSON.stringify(englishRooms)) {
    throw new Error("Czech and English Luxart room-number sets differ.");
  }
  const missingRoomMappings = observedRooms.filter((room) => !resourceMap.has(String(room)));
  if (missingRoomMappings.length > 0) {
    throw new Error(`LUXART_RESOURCE_MAP_JSON is missing observed room numbers: ${missingRoomMappings.join(", ")}.`);
  }
  const authentication = objectValue(evidence.authenticated, "artifacts.luxartReadOnly.authenticated");
  trueValue(authentication.checked, "artifacts.luxartReadOnly.authenticated.checked");
  trueValue(authentication.userLoaded, "artifacts.luxartReadOnly.authenticated.userLoaded");
  const personalized = objectValue(evidence.personalized, "artifacts.luxartReadOnly.personalized");
  trueValue(personalized.checked, "artifacts.luxartReadOnly.personalized.checked");
  let expectedEligible: number | undefined;
  let expectedIneligible: number | undefined;
  for (const [language, label] of [["czech", "Czech"], ["english", "English"]] as const) {
    const localized = objectValue(personalized[language], `artifacts.luxartReadOnly.personalized.${language}`);
    if (integerValue(localized.count, `Luxart personalized ${label} count`, 1) !== count) {
      throw new Error(`The personalized ${label} Luxart feed does not contain every anonymous lesson.`);
    }
    exactString(
      localized.occurrenceSetSha256,
      occurrenceSha,
      `Luxart personalized ${label} occurrence digest`,
    );
    const eligible = integerValue(localized.eligible, `Luxart personalized ${label} eligible count`);
    const ineligible = integerValue(localized.ineligible, `Luxart personalized ${label} ineligible count`);
    if (eligible + ineligible !== count) {
      throw new Error(`Every personalized ${label} Luxart lesson must have known binary eligibility.`);
    }
    if (expectedEligible !== undefined && (eligible !== expectedEligible || ineligible !== expectedIneligible)) {
      throw new Error("Czech and English personalized Luxart eligibility counts differ.");
    }
    expectedEligible = eligible;
    expectedIneligible = ineligible;
  }
  return { count, reformer, occurrenceSha, observedRooms, range, lessonRange: czechRange };
}

function validateRuntimeEvidence(
  evidence: JsonObject,
  stagingOrigin: string,
  luxart: ReturnType<typeof validateLuxartEvidence>,
  rateLimitMode: "memory" | "postgres",
  releaseCommit: string,
  launchMode: string,
) {
  exactString(cleanHttpsOrigin(evidence.target, "artifacts.runtimeProbe.target"), stagingOrigin, "Runtime evidence target");
  const checks = objectValue(evidence.checks, "artifacts.runtimeProbe.checks");
  trueValue(objectValue(checks.browserSecurity, "runtime browserSecurity").ok, "runtime browserSecurity.ok");
  trueValue(objectValue(checks.health, "runtime health").ok, "runtime health.ok");
  const readiness = objectValue(checks.readiness, "runtime readiness");
  trueValue(readiness.ok, "runtime readiness.ok");
  exactString(readiness.mode, "live", "runtime readiness.mode");
  exactString(stringValue(readiness.commit, "runtime readiness.commit").toLowerCase(), releaseCommit, "runtime readiness.commit");
  exactString(readiness.phase, launchMode, "runtime readiness.phase");
  exactString(readiness.region, "fra1", "runtime readiness.region");
  exactString(readiness.luxart, "reachable", "runtime readiness.luxart");
  exactString(readiness.schedule, "ready", "runtime readiness.schedule");
  exactString(readiness.rateLimit, rateLimitMode, "runtime readiness.rateLimit");
  exactString(readiness.booking, "ready", "runtime readiness.booking");
  const capabilities = objectValue(readiness.capabilities, "runtime readiness.capabilities");
  trueValue(capabilities.reservationsEnabled, "runtime reservationsEnabled");
  falseValue(capabilities.waitlistEnabled, "runtime waitlistEnabled");
  exactString(capabilities.businessRulesStatus, "confirmed", "runtime businessRulesStatus");
  exactString(capabilities.favoritesSync, "device", "runtime favoritesSync");
  falseValue(capabilities.forgotPasswordEnabled, "runtime forgotPasswordEnabled");
  trueValue(capabilities.englishEnabled, "runtime englishEnabled");
  if (launchMode === "booking_without_payments") {
    exactString(readiness.payments, "disabled", "runtime readiness.payments");
    falseValue(capabilities.topupsEnabled, "runtime topupsEnabled");
    exactString(capabilities.topupMode, "disabled", "runtime topupMode");
  } else {
    exactString(readiness.payments, "ready", "runtime readiness.payments");
    trueValue(capabilities.topupsEnabled, "runtime topupsEnabled");
    exactString(capabilities.topupMode, "stripe", "runtime topupMode");
  }
  const lessons = objectValue(checks.lessons, "runtime lessons");
  trueValue(lessons.ok, "runtime lessons.ok");
  const runtimeRange = validateScheduleRange(
    { checkedAt: evidence.checkedAt, range: lessons.range },
    "runtime lessons",
  );
  if (JSON.stringify(runtimeRange) !== JSON.stringify(luxart.range)) {
    throw new Error("Runtime and Luxart evidence do not cover the same seven-day Prague range.");
  }
  for (const [language, label] of [["czech", "Czech"], ["english", "English"]] as const) {
    const localized = objectValue(lessons[language], `runtime lessons.${language}`);
    trueValue(localized.ok, `runtime lessons.${language}.ok`);
    if (integerValue(localized.count, `runtime lessons.${language}.count`, 1) !== luxart.count) {
      throw new Error(`The ${label} application runtime does not expose the full Luxart lesson count.`);
    }
    exactString(
      localized.occurrenceSetSha256,
      luxart.occurrenceSha,
      `runtime ${label} lesson occurrence digest`,
    );
    if (integerValue(localized.reformer, `runtime lessons.${language}.reformer`, 1) !== luxart.reformer) {
      throw new Error(`The ${label} application runtime does not expose the full Luxart Reformer count.`);
    }
    const localizedRange = validateLessonRangeEvidence(localized, runtimeRange, `runtime lessons.${language}`);
    if (JSON.stringify(localizedRange) !== JSON.stringify(luxart.lessonRange)) {
      throw new Error(`The ${label} application runtime does not expose the full Luxart lesson range.`);
    }
  }
}

export function validateBookingUatEvidence(
  evidence: JsonObject,
  stagingOrigin: string,
  resourceMap: Map<string, number>,
  expectedCommit: string,
  launchMode: string,
) {
  exactString(cleanHttpsOrigin(evidence.target, "artifacts.bookingMutationUat.target"), stagingOrigin, "Booking UAT target");
  trueValue(evidence.deploymentProvenanceVerified, "booking UAT deploymentProvenanceVerified");
  exactString(
    stringValue(evidence.commit, "booking UAT commit").toLowerCase(),
    expectedCommit,
    "booking UAT commit",
  );
  exactString(evidence.phase, launchMode, "booking UAT phase");
  exactString(evidence.region, "fra1", "booking UAT region");
  trueValue(evidence.userVerified, "booking UAT userVerified");
  trueValue(evidence.personalizedEligibilityVerified, "booking UAT personalizedEligibilityVerified");
  trueValue(evidence.authoritativeAvailabilityVerified, "booking UAT authoritativeAvailabilityVerified");
  trueValue(evidence.reservationWindowVerified, "booking UAT reservationWindowVerified");
  trueValue(evidence.onlineCancellationVerified, "booking UAT onlineCancellationVerified");
  const lessonRoomNumber = integerValue(evidence.lessonRoomNumber, "booking UAT lessonRoomNumber", 1);
  if (!resourceMap.has(String(lessonRoomNumber))) {
    throw new Error("The booking UAT lesson room is missing from LUXART_RESOURCE_MAP_JSON.");
  }
  for (const key of ["lessonIdSha256", "reservationIdSha256"] as const) {
    const digest = stringValue(evidence[key], `booking UAT ${key}`);
    if (!/^[a-f0-9]{16}$/.test(digest)) {
      throw new Error(`booking UAT ${key} must be a 16-character lowercase SHA-256 prefix.`);
    }
  }
  integerValue(evidence.expectedCancellationFeeKc, "booking UAT expectedCancellationFeeKc");
  integerValue(evidence.sameKeyCreateReplays, "booking UAT sameKeyCreateReplays", 3);
  integerValue(evidence.parallelCreateRequests, "booking UAT parallelCreateRequests", 2);
  integerValue(evidence.sameKeyCancellationReplays, "booking UAT sameKeyCancellationReplays", 3);
  trueValue(evidence.crossKeyCancellationReplay, "booking UAT crossKeyCancellationReplay");
  trueValue(evidence.oneActiveReservationObserved, "booking UAT oneActiveReservationObserved");
  trueValue(evidence.preExistingActiveReservationsPreserved, "booking UAT preExistingActiveReservationsPreserved");
  trueValue(evidence.finalStateRestored, "booking UAT finalStateRestored");
  trueValue(evidence.cancellationFeeMatched, "booking UAT cancellationFeeMatched");
  const requestIds = stringArray(evidence.requestIds, "booking UAT requestIds");
  if (requestIds.length < 8) {
    throw new Error("Booking UAT evidence contains too few correlated request IDs.");
  }
  if (new Set(requestIds).size !== requestIds.length) {
    throw new Error("Booking UAT evidence request IDs must be unique.");
  }
}

export function validateRollbackEvidence(evidence: JsonObject, stagingOrigin: string) {
  exactString(cleanHttpsOrigin(evidence.target, "artifacts.rollback.target"), stagingOrigin, "Rollback target");
  const durationMs = integerValue(evidence.durationMs, "rollback durationMs");
  const maximumDurationMs = integerValue(evidence.maximumDurationMs, "rollback maximumDurationMs", 1);
  if (maximumDurationMs > 300_000 || durationMs > maximumDurationMs) {
    throw new Error("Rollback evidence does not prove the five-minute recovery objective.");
  }
  integerValue(evidence.lessonCount, "rollback lessonCount", 1);
  for (const key of ["healthReady", "luxartReadable", "bookingReadOnly", "waitlistReadOnly", "paymentsDisabled"]) {
    trueValue(evidence[key], `rollback ${key}`);
  }
  const requestIds = stringArray(evidence.requestIds, "rollback requestIds");
  if (requestIds.length < 7) throw new Error("Rollback evidence contains too few correlated request IDs.");
  if (new Set(requestIds).size !== requestIds.length) {
    throw new Error("Rollback evidence request IDs must be unique.");
  }
}

export function validateAlertEvidence(evidence: JsonObject, stagingOrigin: string) {
  exactString(cleanHttpsOrigin(evidence.applicationOrigin, "artifacts.alertDelivery.applicationOrigin"), stagingOrigin, "Alert application origin");
  const status = integerValue(evidence.responseStatus, "alert responseStatus", 200);
  if (status > 299) throw new Error("Alert delivery evidence must contain an HTTP 2xx response.");
  trueValue(evidence.supportOwnerConfigured, "alert supportOwnerConfigured");
  trueValue(evidence.manualReceiptConfirmationRequired, "alert manualReceiptConfirmationRequired");
  const eventId = stringValue(evidence.eventId, "alert eventId");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(eventId)) {
    throw new Error("Alert eventId must be a UUIDv4.");
  }
  const fingerprint = stringValue(evidence.alertTargetFingerprint, "alert target fingerprint");
  if (!/^[0-9a-f]{16}$/.test(fingerprint)) {
    throw new Error("Alert target fingerprint must be 16 lowercase hexadecimal characters.");
  }
  return eventId;
}

function validateStripeUatEvidence(evidence: JsonObject, stagingOrigin: string) {
  exactString(cleanHttpsOrigin(evidence.target, "artifacts.stripeUat.target"), stagingOrigin, "Stripe UAT target");
  for (const key of ["paidSessionCreditedExactlyOnce", "duplicateWebhookIgnored", "failedPaymentLeftCreditUnchanged", "finalStateReconciled"]) {
    trueValue(evidence[key], `Stripe UAT ${key}`);
  }
}

export function verifyPilotReleaseEvidence(environment: Environment = process.env, now = new Date()) {
  const dossierPath = resolve(required(environment, "ZONE4YOU_RELEASE_DOSSIER_PATH"));
  const dossierFile = readBoundedJson(dossierPath, "release dossier");
  const expectedConfirmation = `VERIFY_ZONE4YOU_RELEASE_DOSSIER:${dossierFile.sha256}`;
  if (environment.ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION !== expectedConfirmation) {
    throw new Error(`ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION must exactly equal ${expectedConfirmation}.`);
  }

  const dossier = dossierFile.data;
  if (dossier.schemaVersion !== 2) throw new Error("release dossier schemaVersion must be 2.");
  falseValue(dossier.draft, "release dossier draft");
  const releaseId = stringValue(dossier.releaseId, "releaseId");
  const target = cleanHttpsOrigin(dossier.target, "target");
  exactString(target, productionOrigin, "release target");
  const stagingTarget = cleanHttpsOrigin(dossier.stagingTarget, "stagingTarget");
  if (stagingTarget === target) throw new Error("stagingTarget must not be the production target.");
  const luxartOrigin = cleanHttpsOrigin(dossier.luxartOrigin, "luxartOrigin");

  const expectedCommit = required(environment, "ZONE4YOU_RELEASE_COMMIT").toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(expectedCommit)) throw new Error("ZONE4YOU_RELEASE_COMMIT must be a full 40-character Git SHA.");
  exactString(stringValue(dossier.commit, "commit").toLowerCase(), expectedCommit, "release commit");

  const launchMode = stringValue(dossier.launchMode, "launchMode");
  if (!["booking_without_payments", "booking_with_stripe"].includes(launchMode)) {
    throw new Error("launchMode must be booking_without_payments or booking_with_stripe.");
  }
  const maximumAgeHours = integerValue(dossier.maximumEvidenceAgeHours, "maximumEvidenceAgeHours", 1);
  if (maximumAgeHours > 168) throw new Error("maximumEvidenceAgeHours must not exceed 168 hours.");

  const launchWindow = objectValue(dossier.launchWindow, "launchWindow");
  const startsAt = new Date(stringValue(launchWindow.startsAt, "launchWindow.startsAt"));
  const endsAt = new Date(stringValue(launchWindow.endsAt, "launchWindow.endsAt"));
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
    throw new Error("launchWindow must contain a valid increasing time range.");
  }
  if (endsAt.getTime() - startsAt.getTime() > 24 * 3_600_000) {
    throw new Error("launchWindow must not exceed 24 hours.");
  }
  if (now.getTime() < startsAt.getTime() - 15 * 60_000 || now.getTime() > endsAt.getTime()) {
    throw new Error("The release evidence gate may pass only from 15 minutes before the approved launch window until its end.");
  }

  const dossierDirectory = dirname(dossierPath);
  const artifacts = objectValue(dossier.artifacts, "artifacts");
  const loadedArtifacts: Array<{ name: string; sha256: string }> = [];
  const load = (name: string, ageHours = maximumAgeHours) => {
    const loaded = artifact(dossierDirectory, artifacts, name, now, ageHours);
    loadedArtifacts.push({ name, sha256: loaded.sha256 });
    return loaded.data;
  };

  const gatewayAuth = assertConfirmedLuxartGatewayAuth(environment);
  const rateLimitMode = environment.RATE_LIMIT_MODE;
  if (!["memory", "postgres"].includes(rateLimitMode ?? "")) {
    throw new Error("RATE_LIMIT_MODE must be explicit for the verified pilot release.");
  }
  if (!rateLimitRuntimeReady({ ...environment, LUXART_MOCK: "false" })) {
    throw new Error("The configured production rate limiter is not ready for the verified pilot release.");
  }
  const resources = roomMap(environment);
  const luxart = validateLuxartEvidence(load("luxartReadOnly"), luxartOrigin, resources, gatewayAuth.mode);
  validateRuntimeEvidence(
    load("runtimeProbe"),
    stagingTarget,
    luxart,
    rateLimitMode as "memory" | "postgres",
    expectedCommit,
    launchMode,
  );
  validateBookingUatEvidence(load("bookingMutationUat"), stagingTarget, resources, expectedCommit, launchMode);
  validateRollbackEvidence(load("rollback", Math.min(24, maximumAgeHours)), stagingTarget);
  const dnsRollbackReference = objectValue(artifacts.dnsRollbackBaseline, "artifacts.dnsRollbackBaseline");
  const dnsRollbackPathValue = stringValue(dnsRollbackReference.path, "artifacts.dnsRollbackBaseline.path");
  const dnsRollbackPath = isAbsolute(dnsRollbackPathValue)
    ? dnsRollbackPathValue
    : resolve(dossierDirectory, dnsRollbackPathValue);
  if ((lstatSync(dnsRollbackPath).mode & 0o077) !== 0) {
    throw new Error("artifacts.dnsRollbackBaseline must not be accessible by group or other users.");
  }
  validateProductionDomainBaselineEvidence(load("dnsRollbackBaseline", Math.min(24, maximumAgeHours)));
  const alertEventId = validateAlertEvidence(load("alertDelivery"), stagingTarget);
  if (launchMode === "booking_with_stripe") validateStripeUatEvidence(load("stripeUat"), stagingTarget);

  const approvals = objectValue(dossier.approvals, "approvals");
  const uat = requireApproval(approvals, "uat", now, maximumAgeHours);
  exactString(uat.decision, "GO", "approvals.uat.decision");
  if (integerValue(uat.openP0, "approvals.uat.openP0") !== 0 || integerValue(uat.openP1, "approvals.uat.openP1") !== 0) {
    throw new Error("UAT approval must have zero open P0 and P1 findings.");
  }
  const alertReceipt = requireApproval(approvals, "alertReceipt", now, maximumAgeHours);
  trueValue(alertReceipt.confirmed, "approvals.alertReceipt.confirmed");
  exactString(alertReceipt.eventId, alertEventId, "approvals.alertReceipt.eventId");
  const fallback = requireApproval(approvals, "memberzoneFallback", now, Math.min(24, maximumAgeHours));
  trueValue(fallback.available, "approvals.memberzoneFallback.available");
  const cutover = requireApproval(approvals, "cutover", now, Math.min(24, maximumAgeHours));
  trueValue(cutover.approved, "approvals.cutover.approved");

  return {
    ok: true,
    checkedAt: now.toISOString(),
    dossierFingerprint: dossierFile.sha256.slice(0, 16),
    releaseId,
    target,
    stagingTarget,
    commit: expectedCommit,
    launchMode,
    paymentsIncluded: launchMode === "booking_with_stripe",
    conditions: {
      liveLuxartVerified: true,
      allObservedRoomsMapped: true,
      fullLessonFeedMatched: true,
      personalizedEligibilityVerified: true,
      exactSevenDayPragueRangeVerified: true,
      bookingMutationUatPassed: true,
      rollbackUnderFiveMinutes: true,
      dnsRollbackBaselineReady: true,
      alertReceiptConfirmed: true,
      noOpenP0P1: true,
      memberzoneFallbackAvailable: true,
      explicitCutoverApproval: true,
    },
    artifacts: loadedArtifacts,
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  try {
    console.log(JSON.stringify(verifyPilotReleaseEvidence(), null, 2));
  } catch (error) {
    console.error(`Pilot release evidence verification failed: ${error instanceof Error ? error.message : "Unknown error."}`);
    process.exitCode = 1;
  }
}
