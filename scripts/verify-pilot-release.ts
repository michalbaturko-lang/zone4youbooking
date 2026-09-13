import { createHash } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertConfirmedLuxartGatewayAuth, type LuxartGatewayAuthMode } from "../src/lib/luxartGatewayAuth";
import { parseLuxartResourceMapping } from "../src/lib/luxartMappings";
import { luxartResourceMappingSha256 } from "../src/lib/luxartResourceMappingFingerprint";
import { bookingRules } from "../src/lib/bookingRules";
import { rateLimitRuntimeReady } from "../src/lib/rateLimit";
import { zone4YouDateKey, zone4YouScheduleRange, zone4YouTimeZone } from "../src/lib/zone4YouTime";
import { validateProductionDomainBaselineEvidence } from "./capture-production-domain-baseline";
import { readStableReleaseJson } from "./release-evidence-file";
import { assertSupportedLuxartApiContract, supportedLuxartApiContract } from "../src/lib/luxartApiContract";
import {
  approvedLuxartReferenceSemanticContractSha256,
  luxartPublicContractEndpoints,
} from "./verify-luxart-public-contract";
import { memberzoneFallbackUrl } from "./verify-memberzone-fallback";
import { maximumOperationalAmountKc } from "../src/lib/moneyBounds";
import {
  bookingMutationUatEvidenceSchemaVersion,
  bookingMutationUatScenarioEvidenceSchemaVersion,
  type BookingMutationUatLessonKind,
} from "./verify-booking-mutations";
import {
  validateReadonlyRollbackTimerEvidence,
  type ReadonlyRollbackTimerEvidence,
} from "./start-readonly-rollback";

type Environment = Record<string, string | undefined>;
type JsonObject = Record<string, unknown>;

interface JsonEvidenceFile {
  data: JsonObject;
  sha256: string;
}

const maximumJsonBytes = 256 * 1024;
const productionOrigin = "https://booking.zone4you.cz";
const placeholderApprovalIdentities = new Set([
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

function approvalIdentity(value: unknown, label: string) {
  const identity = stringValue(value, label);
  if (identity.length > 120) throw new Error(`${label} must contain at most 120 characters.`);
  if (/\p{Cc}/u.test(identity)) throw new Error(`${label} must not contain control characters.`);
  const normalized = identity
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[_./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (placeholderApprovalIdentities.has(normalized) || normalized.startsWith("replace with ")) {
    throw new Error(`${label} must identify the actual approving person or operational role.`);
  }
  return identity;
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

function readBoundedJson(path: string, label: string, ownerOnly = false): JsonEvidenceFile {
  const loaded = readStableReleaseJson(path, label, { maximumBytes: maximumJsonBytes, ownerOnly });
  return {
    data: objectValue(loaded.data, label),
    sha256: loaded.sha256,
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
  const loaded = readBoundedJson(
    path,
    `artifacts.${name}`,
    name === "dnsRollbackBaseline" || name === "memberzoneFallback" || name === "rollbackTimer",
  );
  if (loaded.sha256 !== expectedSha256) throw new Error(`artifacts.${name} SHA-256 does not match the dossier.`);
  trueValue(loaded.data.ok, `artifacts.${name}.ok`);
  const evidenceCheckedAt = checkedAt(loaded.data.checkedAt, `artifacts.${name}`, now, maximumAgeHours);
  return { ...loaded, path, checkedAt: evidenceCheckedAt };
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
): JsonObject {
  const approval = objectValue(approvals[name], `approvals.${name}`);
  approvalIdentity(approval.approvedBy, `approvals.${name}.approvedBy`);
  const normalizedApprovedAt = approvedAt(approval.approvedAt, `approvals.${name}`, now, maximumAgeHours);
  return { ...approval, approvedAt: normalizedApprovedAt };
}

function latestTimestamp(values: Array<{ label: string; timestamp: string }>) {
  if (values.length === 0) throw new Error("At least one timestamp is required for release chronology.");
  return values.reduce((latest, candidate) =>
    Date.parse(candidate.timestamp) >= Date.parse(latest.timestamp) ? candidate : latest
  );
}

function requireApprovalAfter(
  approval: JsonObject,
  approvalName: string,
  prerequisites: Array<{ label: string; timestamp: string }>,
) {
  const approvedAtValue = stringValue(approval.approvedAt, `approvals.${approvalName}.approvedAt`);
  const latest = latestTimestamp(prerequisites);
  if (Date.parse(approvedAtValue) < Date.parse(latest.timestamp)) {
    throw new Error(`approvals.${approvalName}.approvedAt must not predate ${latest.label}.`);
  }
}

function resourceMapping(environment: Environment) {
  const raw = required(environment, "LUXART_RESOURCE_MAP_JSON");
  const mapping = parseLuxartResourceMapping(raw);
  return {
    rooms: new Map(Object.entries(mapping)),
    sha256: luxartResourceMappingSha256(raw),
  };
}

export function validateLuxartEvidence(
  evidence: JsonObject,
  expectedLuxartOrigin: string,
  resourceMap: Map<string, number>,
  gatewayAuthMode: LuxartGatewayAuthMode,
) {
  const expectedOrigin = new URL(expectedLuxartOrigin);
  const expectedPort = expectedOrigin.port || (expectedOrigin.protocol === "https:" ? "443" : "80");
  const expectedFingerprint = createHash("sha256").update(expectedOrigin.origin).digest("hex");
  const d1 = objectValue(evidence.d1, "artifacts.luxartReadOnly.d1");
  if (d1.schemaVersion !== 5) {
    throw new Error("artifacts.luxartReadOnly.d1.schemaVersion must be 5.");
  }
  exactString(d1.apiContract, supportedLuxartApiContract, "Luxart D1 apiContract");
  exactString(evidence.apiContract, supportedLuxartApiContract, "Luxart evidence apiContract");
  exactString(
    stringValue(d1.checkedAt, "Luxart D1 checkedAt"),
    stringValue(evidence.checkedAt, "Luxart evidence checkedAt"),
    "Luxart D1 checkedAt",
  );
  exactString(
    d1.targetFingerprintSha256,
    expectedFingerprint,
    "Luxart D1 targetFingerprintSha256",
  );
  exactString(d1.helpTransport, "https", "Luxart D1 helpTransport");
  exactString(d1.helpPort, expectedPort, "Luxart D1 helpPort");
  exactString(d1.gatewayAuthMode, gatewayAuthMode, "Luxart D1 gatewayAuthMode");
  exactString(
    stringValue(d1.contractCheckedAt, "Luxart D1 contractCheckedAt"),
    stringValue(evidence.checkedAt, "Luxart evidence checkedAt"),
    "Luxart D1 contractCheckedAt",
  );
  if (integerValue(d1.contractEndpointCount, "Luxart D1 contractEndpointCount", 1) !== luxartPublicContractEndpoints.length) {
    throw new Error(`Luxart D1 contractEndpointCount must be ${luxartPublicContractEndpoints.length}.`);
  }
  exactString(
    d1.contractSemanticSha256,
    approvedLuxartReferenceSemanticContractSha256,
    "Luxart D1 contractSemanticSha256",
  );
  trueValue(d1.contractBaselineVerified, "Luxart D1 contractBaselineVerified");
  trueValue(d1.approvedOriginFingerprintVerified, "Luxart D1 approvedOriginFingerprintVerified");
  trueValue(d1.authenticatedReadOnlyVerified, "Luxart D1 authenticatedReadOnlyVerified");
  trueValue(d1.personalizedLessonSetVerified, "Luxart D1 personalizedLessonSetVerified");
  trueValue(d1.loginQueryLoggingConfirmed, "Luxart D1 loginQueryLoggingConfirmed");
  approvalIdentity(d1.loginQueryLoggingConfirmedBy, "Luxart D1 loginQueryLoggingConfirmedBy");
  const loginQueryLoggingConfirmedAt = approvedAt(
    d1.loginQueryLoggingConfirmedAt,
    "Luxart D1 loginQueryLogging",
    new Date(stringValue(d1.checkedAt, "Luxart D1 checkedAt")),
    30 * 24,
  );
  if (Date.parse(loginQueryLoggingConfirmedAt) > Date.parse(stringValue(d1.checkedAt, "Luxart D1 checkedAt"))) {
    throw new Error("Luxart D1 login query logging confirmation must not postdate the D1 verification.");
  }
  const helpClassification = stringValue(d1.helpClassification, "Luxart D1 helpClassification");
  const helpStatus = integerValue(d1.helpHttpStatus, "Luxart D1 helpHttpStatus", 1);
  if (helpClassification === "ready") {
    if (helpStatus !== 200) throw new Error("A ready Luxart D1 Help probe must contain HTTP 200.");
    if (!/^[a-f0-9]{64}$/.test(stringValue(d1.helpBodySha256, "Luxart D1 helpBodySha256"))) {
      throw new Error("Luxart D1 helpBodySha256 must be a full lowercase SHA-256 digest.");
    }
  } else if (helpClassification === "authentication_required") {
    if (![401, 403].includes(helpStatus) || gatewayAuthMode === "none") {
      throw new Error("A challenged Luxart D1 Help probe requires HTTP 401/403 and confirmed gateway authentication.");
    }
  } else {
    throw new Error("Luxart D1 helpClassification must prove documentation or a confirmed gateway challenge.");
  }

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
  const roomPlacementSha = stringValue(
    czech.roomPlacementSetSha256,
    "Luxart Czech room-placement digest",
  );
  if (
    !/^[a-f0-9]{64}$/.test(roomPlacementSha) ||
    english.roomPlacementSetSha256 !== roomPlacementSha
  ) {
    throw new Error("Czech and English Luxart room-placement digests must be the same full SHA-256.");
  }
  const localizedContentSha256 = {
    czech: stringValue(czech.lessonContentSetSha256, "Luxart Czech lesson-content digest"),
    english: stringValue(english.lessonContentSetSha256, "Luxart English lesson-content digest"),
  };
  for (const [language, digest] of Object.entries(localizedContentSha256)) {
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error(`Luxart ${language} lesson-content digest must be a full lowercase SHA-256.`);
    }
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
    exactString(
      localized.roomPlacementSetSha256,
      roomPlacementSha,
      `Luxart personalized ${label} room-placement digest`,
    );
    exactString(
      localized.lessonContentSetSha256,
      localizedContentSha256[language],
      `Luxart personalized ${label} lesson-content digest`,
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
  return {
    count,
    reformer,
    occurrenceSha,
    roomPlacementSha,
    localizedContentSha256,
    observedRooms: [...new Set(observedRooms)].sort((left, right) => left - right),
    range,
    lessonRange: czechRange,
  };
}

function validateRuntimeEvidence(
  evidence: JsonObject,
  stagingOrigin: string,
  luxart: ReturnType<typeof validateLuxartEvidence>,
  rateLimitMode: "memory" | "postgres",
  releaseCommit: string,
  launchMode: string,
  resourceMapSha256: string,
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
  exactString(readiness.bookingNotifications, "ready", "runtime readiness.bookingNotifications");
  exactString(
    readiness.resourceMapSha256,
    resourceMapSha256,
    "runtime readiness.resourceMapSha256",
  );
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
    exactString(
      localized.roomPlacementSetSha256,
      luxart.roomPlacementSha,
      `runtime ${label} lesson room-placement digest`,
    );
    exactString(
      localized.lessonContentSetSha256,
      luxart.localizedContentSha256[language],
      `runtime ${label} lesson-content digest`,
    );
    const runtimeRoomNumbers = Array.isArray(localized.roomNumbers)
      ? localized.roomNumbers.map((room, index) =>
        integerValue(room, `runtime lessons.${language}.roomNumbers[${index}]`, 1)
      )
      : [];
    if (JSON.stringify(runtimeRoomNumbers) !== JSON.stringify(luxart.observedRooms)) {
      throw new Error(`The ${label} application runtime does not expose the approved Luxart room-number set.`);
    }
    if (integerValue(localized.reformer, `runtime lessons.${language}.reformer`, 1) !== luxart.reformer) {
      throw new Error(`The ${label} application runtime does not expose the full Luxart Reformer count.`);
    }
    const localizedRange = validateLessonRangeEvidence(localized, runtimeRange, `runtime lessons.${language}`);
    if (JSON.stringify(localizedRange) !== JSON.stringify(luxart.lessonRange)) {
      throw new Error(`The ${label} application runtime does not expose the full Luxart lesson range.`);
    }
  }
}

export function validateBookingUatScenarioEvidence(
  evidence: JsonObject,
  stagingOrigin: string,
  resourceMap: Map<string, number>,
  resourceMapSha256: string,
  expectedCommit: string,
  launchMode: string,
  expectedLessonKind: BookingMutationUatLessonKind,
) {
  const label = `booking UAT ${expectedLessonKind}`;
  if (evidence.schemaVersion !== bookingMutationUatScenarioEvidenceSchemaVersion) {
    throw new Error(
      `${label} scenario schemaVersion must be ${bookingMutationUatScenarioEvidenceSchemaVersion}.`,
    );
  }
  trueValue(evidence.ok, `${label}.ok`);
  exactString(cleanHttpsOrigin(evidence.target, `${label}.target`), stagingOrigin, `${label} target`);
  trueValue(evidence.deploymentProvenanceVerified, `${label} deploymentProvenanceVerified`);
  exactString(
    stringValue(evidence.commit, `${label} commit`).toLowerCase(),
    expectedCommit,
    `${label} commit`,
  );
  exactString(evidence.phase, launchMode, `${label} phase`);
  exactString(evidence.region, "fra1", `${label} region`);
  exactString(evidence.lessonKind, expectedLessonKind, `${label} lessonKind`);
  trueValue(evidence.userVerified, `${label} userVerified`);
  trueValue(evidence.personalizedEligibilityVerified, `${label} personalizedEligibilityVerified`);
  trueValue(evidence.authoritativeAvailabilityVerified, `${label} authoritativeAvailabilityVerified`);
  trueValue(evidence.reservationWindowVerified, `${label} reservationWindowVerified`);
  trueValue(evidence.onlineCancellationVerified, `${label} onlineCancellationVerified`);
  exactString(
    evidence.resourceMapSha256,
    resourceMapSha256,
    `${label} resourceMapSha256`,
  );
  const lessonRoomNumber = integerValue(evidence.lessonRoomNumber, `${label} lessonRoomNumber`, 1);
  if (!resourceMap.has(String(lessonRoomNumber))) {
    throw new Error(`The ${label} lesson room is missing from LUXART_RESOURCE_MAP_JSON.`);
  }
  for (const key of ["lessonIdSha256", "reservationIdSha256"] as const) {
    const digest = stringValue(evidence[key], `${label} ${key}`);
    if (!/^[a-f0-9]{16}$/.test(digest)) {
      throw new Error(`${label} ${key} must be a 16-character lowercase SHA-256 prefix.`);
    }
  }
  const expectedCancellationFeeKc = integerValue(
    evidence.expectedCancellationFeeKc,
    `${label} expectedCancellationFeeKc`,
  );
  if (expectedCancellationFeeKc > maximumOperationalAmountKc) {
    throw new Error(
      `${label} expectedCancellationFeeKc must not exceed ${maximumOperationalAmountKc}.`,
    );
  }
  integerValue(evidence.sameKeyCreateReplays, `${label} sameKeyCreateReplays`, 3);
  integerValue(evidence.parallelCreateRequests, `${label} parallelCreateRequests`, 2);
  integerValue(evidence.sameKeyCancellationReplays, `${label} sameKeyCancellationReplays`, 3);
  trueValue(evidence.crossKeyCancellationReplay, `${label} crossKeyCancellationReplay`);
  trueValue(evidence.oneActiveReservationObserved, `${label} oneActiveReservationObserved`);
  trueValue(evidence.cancellationStateVerified, `${label} cancellationStateVerified`);
  trueValue(evidence.snapshotRequestIdsRecorded, `${label} snapshotRequestIdsRecorded`);
  trueValue(evidence.preExistingActiveReservationsPreserved, `${label} preExistingActiveReservationsPreserved`);
  trueValue(evidence.finalStateRestored, `${label} finalStateRestored`);
  trueValue(evidence.cancellationFeeMatched, `${label} cancellationFeeMatched`);
  const requestIds = stringArray(evidence.requestIds, `${label} requestIds`);
  if (requestIds.length < 16) {
    throw new Error(`${label} evidence contains too few correlated request IDs.`);
  }
  if (new Set(requestIds).size !== requestIds.length) {
    throw new Error(`${label} evidence request IDs must be unique.`);
  }
  const scenarioCheckedAt = new Date(stringValue(evidence.checkedAt, `${label}.checkedAt`));
  if (!Number.isFinite(scenarioCheckedAt.getTime())) throw new Error(`${label}.checkedAt must be a valid timestamp.`);
  return {
    checkedAt: scenarioCheckedAt,
    lessonKind: expectedLessonKind,
    lessonRoomNumber,
    lessonIdSha256: stringValue(evidence.lessonIdSha256, `${label} lessonIdSha256`),
    reservationIdSha256: stringValue(evidence.reservationIdSha256, `${label} reservationIdSha256`),
    requestIds,
  };
}

export function validateBookingUatEvidence(
  evidence: JsonObject,
  stagingOrigin: string,
  resourceMap: Map<string, number>,
  resourceMapSha256: string,
  expectedCommit: string,
  launchMode: string,
) {
  if (evidence.schemaVersion !== bookingMutationUatEvidenceSchemaVersion) {
    throw new Error(
      `Booking UAT evidence schemaVersion must be ${bookingMutationUatEvidenceSchemaVersion}.`,
    );
  }
  trueValue(evidence.ok, "booking UAT.ok");
  exactString(cleanHttpsOrigin(evidence.target, "artifacts.bookingMutationUat.target"), stagingOrigin, "Booking UAT target");
  trueValue(evidence.deploymentProvenanceVerified, "booking UAT deploymentProvenanceVerified");
  exactString(stringValue(evidence.commit, "booking UAT commit").toLowerCase(), expectedCommit, "booking UAT commit");
  exactString(evidence.phase, launchMode, "booking UAT phase");
  exactString(evidence.region, "fra1", "booking UAT region");
  const expectedScenarioCount = resourceMap.size;
  if (integerValue(evidence.scenarioCount, "booking UAT scenarioCount", 1) !== expectedScenarioCount) {
    throw new Error("booking UAT scenarioCount must exactly equal the number of rooms in LUXART_RESOURCE_MAP_JSON.");
  }
  if (!Array.isArray(evidence.scenarios) || evidence.scenarios.length !== expectedScenarioCount) {
    throw new Error("booking UAT scenarios must contain exactly one evidence item for every mapped room.");
  }
  const scenarios = evidence.scenarios.map((rawScenario, index) => {
    const scenario = objectValue(rawScenario, `booking UAT scenarios[${index}]`);
    const lessonKind = stringValue(scenario.lessonKind, `booking UAT scenarios[${index}].lessonKind`);
    if (!(lessonKind === "standard" || lessonKind === "reformer")) {
      throw new Error(`booking UAT scenarios[${index}].lessonKind must be standard or reformer.`);
    }
    return validateBookingUatScenarioEvidence(
      scenario,
      stagingOrigin,
      resourceMap,
      resourceMapSha256,
      expectedCommit,
      launchMode,
      lessonKind,
    );
  });
  const expectedRoomNumbers = [...resourceMap.keys()].map(Number).sort((left, right) => left - right);
  const observedRoomNumbers = scenarios.map((scenario) => scenario.lessonRoomNumber).sort((left, right) => left - right);
  if (JSON.stringify(observedRoomNumbers) !== JSON.stringify(expectedRoomNumbers)) {
    throw new Error("booking UAT scenarios must cover every mapped room exactly once.");
  }
  if (!scenarios.some((scenario) => scenario.lessonKind === "standard") || !scenarios.some((scenario) => scenario.lessonKind === "reformer")) {
    throw new Error("booking UAT scenarios must include both standard and Reformer lessons.");
  }
  const lessonIds = scenarios.map((scenario) => scenario.lessonIdSha256);
  if (new Set(lessonIds).size !== lessonIds.length) {
    throw new Error("booking UAT scenarios must use distinct lesson occurrences.");
  }
  const reservationIds = scenarios.map((scenario) => scenario.reservationIdSha256);
  if (new Set(reservationIds).size !== reservationIds.length) {
    throw new Error("booking UAT scenarios must record distinct reservations.");
  }
  const allRequestIds = scenarios.flatMap((scenario) => scenario.requestIds);
  if (new Set(allRequestIds).size !== allRequestIds.length) {
    throw new Error("booking UAT request IDs must be unique across all room scenarios.");
  }
  const suiteCheckedAt = new Date(stringValue(evidence.checkedAt, "booking UAT.checkedAt"));
  if (!Number.isFinite(suiteCheckedAt.getTime())) throw new Error("booking UAT.checkedAt must be a valid timestamp.");
  for (const scenario of scenarios) {
    const ageMs = suiteCheckedAt.getTime() - scenario.checkedAt.getTime();
    if (ageMs < 0 || ageMs > 2 * 3_600_000) {
      throw new Error(`booking UAT room ${scenario.lessonRoomNumber}.checkedAt must be no more than two hours before the suite evidence.`);
    }
  }
}

export function validateRollbackEvidence(
  evidence: JsonObject,
  stagingOrigin: string,
  expectedCommit: string,
  timer: ReadonlyRollbackTimerEvidence,
  timerSha256: string,
) {
  if (evidence.schemaVersion !== 2) {
    throw new Error("Rollback evidence schemaVersion must be 2.");
  }
  exactString(cleanHttpsOrigin(evidence.target, "artifacts.rollback.target"), stagingOrigin, "Rollback target");
  exactString(
    stringValue(evidence.commit, "rollback commit").toLowerCase(),
    expectedCommit,
    "rollback commit",
  );
  exactString(evidence.phase, "read_only", "rollback phase");
  exactString(evidence.region, "fra1", "rollback region");
  exactString(evidence.rollbackDrillId, timer.drillId, "rollback drillId");
  exactString(evidence.rollbackTimerSha256, timerSha256, "rollback timer SHA-256");
  const checkedAtValue = stringValue(evidence.checkedAt, "rollback checkedAt");
  exactString(evidence.readOnlyVerifiedAt, checkedAtValue, "rollback readOnlyVerifiedAt");
  exactString(evidence.rollbackStartedAt, timer.startedAt, "rollback rollbackStartedAt");
  const rollbackStartedAt = new Date(timer.startedAt);
  const readOnlyVerifiedAt = new Date(checkedAtValue);
  if (!Number.isFinite(rollbackStartedAt.getTime()) || !Number.isFinite(readOnlyVerifiedAt.getTime())) {
    throw new Error("Rollback evidence timestamps must be valid.");
  }
  const measuredRecoveryDurationMs = readOnlyVerifiedAt.getTime() - rollbackStartedAt.getTime();
  if (measuredRecoveryDurationMs < 0) {
    throw new Error("Rollback evidence cannot verify read-only before rollback started.");
  }
  const recoveryDurationMs = integerValue(evidence.recoveryDurationMs, "rollback recoveryDurationMs");
  if (recoveryDurationMs !== measuredRecoveryDurationMs) {
    throw new Error("Rollback recoveryDurationMs does not match its timestamps.");
  }
  const verificationDurationMs = integerValue(evidence.verificationDurationMs, "rollback verificationDurationMs");
  const maximumDurationMs = integerValue(evidence.maximumDurationMs, "rollback maximumDurationMs", 1);
  if (maximumDurationMs !== timer.maximumDurationMs) {
    throw new Error("Rollback maximumDurationMs does not match its immutable timer evidence.");
  }
  if (
    maximumDurationMs > 300_000 ||
    recoveryDurationMs > maximumDurationMs ||
    verificationDurationMs > recoveryDurationMs
  ) {
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

export function validateMemberzoneFallbackEvidence(evidence: JsonObject) {
  if (evidence.schemaVersion !== 1) {
    throw new Error("Memberzone fallback evidence schemaVersion must be 1.");
  }
  exactString(evidence.target, memberzoneFallbackUrl.href, "Memberzone fallback target");
  exactString(
    evidence.targetFingerprintSha256,
    createHash("sha256").update(memberzoneFallbackUrl.href).digest("hex"),
    "Memberzone fallback targetFingerprintSha256",
  );
  exactString(evidence.transport, "https", "Memberzone fallback transport");
  if (integerValue(evidence.httpStatus, "Memberzone fallback httpStatus", 200) !== 200) {
    throw new Error("Memberzone fallback httpStatus must be 200.");
  }
  exactString(evidence.contentType, "text/html", "Memberzone fallback contentType");
  const bodyBytes = integerValue(evidence.bodyBytes, "Memberzone fallback bodyBytes", 1);
  if (bodyBytes > 512 * 1024) {
    throw new Error("Memberzone fallback bodyBytes exceeds the verified limit.");
  }
  if (!/^[a-f0-9]{64}$/.test(stringValue(evidence.bodySha256, "Memberzone fallback bodySha256"))) {
    throw new Error("Memberzone fallback bodySha256 must be a full lowercase SHA-256 digest.");
  }
  for (const key of ["schedulerDetected", "signInPathDetected", "nonEmptyScheduleDetected", "reformerDetected"] as const) {
    trueValue(evidence[key], `Memberzone fallback ${key}`);
  }
}

function validateStripeUatEvidence(evidence: JsonObject, stagingOrigin: string) {
  exactString(cleanHttpsOrigin(evidence.target, "artifacts.stripeUat.target"), stagingOrigin, "Stripe UAT target");
  for (const key of ["paidSessionCreditedExactlyOnce", "duplicateWebhookIgnored", "failedPaymentLeftCreditUnchanged", "finalStateReconciled"]) {
    trueValue(evidence[key], `Stripe UAT ${key}`);
  }
}

export function verifyPilotReleaseEvidence(environment: Environment = process.env, now = new Date()) {
  const dossierPath = resolve(required(environment, "ZONE4YOU_RELEASE_DOSSIER_PATH"));
  const dossierFile = readBoundedJson(dossierPath, "release dossier", true);
  const expectedConfirmation = `VERIFY_ZONE4YOU_RELEASE_DOSSIER:${dossierFile.sha256}`;
  if (environment.ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION !== expectedConfirmation) {
    throw new Error(`ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION must exactly equal ${expectedConfirmation}.`);
  }

  const dossier = dossierFile.data;
  if (dossier.schemaVersion !== 6) throw new Error("release dossier schemaVersion must be 6.");
  falseValue(dossier.draft, "release dossier draft");
  const releaseId = stringValue(dossier.releaseId, "releaseId");
  const target = cleanHttpsOrigin(dossier.target, "target");
  exactString(target, productionOrigin, "release target");
  const stagingTarget = cleanHttpsOrigin(dossier.stagingTarget, "stagingTarget");
  if (stagingTarget === target) throw new Error("stagingTarget must not be the production target.");
  const luxartOrigin = cleanHttpsOrigin(dossier.luxartOrigin, "luxartOrigin");
  const apiContract = assertSupportedLuxartApiContract(environment);
  exactString(dossier.luxartApiContract, apiContract, "luxartApiContract");

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
  const artifactTimes = new Map<string, string>();
  const load = (name: string, ageHours = maximumAgeHours) => {
    const loaded = artifact(dossierDirectory, artifacts, name, now, ageHours);
    loadedArtifacts.push({ name, sha256: loaded.sha256 });
    artifactTimes.set(name, loaded.checkedAt);
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
  const resources = resourceMapping(environment);
  const luxart = validateLuxartEvidence(load("luxartReadOnly"), luxartOrigin, resources.rooms, gatewayAuth.mode);
  validateRuntimeEvidence(
    load("runtimeProbe"),
    stagingTarget,
    luxart,
    rateLimitMode as "memory" | "postgres",
    expectedCommit,
    launchMode,
    resources.sha256,
  );
  validateBookingUatEvidence(
    load("bookingMutationUat"),
    stagingTarget,
    resources.rooms,
    resources.sha256,
    expectedCommit,
    launchMode,
  );
  const rollbackTimerEvidence = load("rollbackTimer", Math.min(24, maximumAgeHours));
  const rollbackTimer = validateReadonlyRollbackTimerEvidence(rollbackTimerEvidence);
  exactString(rollbackTimer.target, stagingTarget, "Rollback timer target");
  exactString(rollbackTimer.commit, expectedCommit, "Rollback timer commit");
  const rollbackTimerReference = objectValue(artifacts.rollbackTimer, "artifacts.rollbackTimer");
  const rollbackTimerSha256 = stringValue(
    rollbackTimerReference.sha256,
    "artifacts.rollbackTimer.sha256",
  ).toLowerCase();
  validateRollbackEvidence(
    load("rollback", Math.min(24, maximumAgeHours)),
    stagingTarget,
    expectedCommit,
    rollbackTimer,
    rollbackTimerSha256,
  );
  validateProductionDomainBaselineEvidence(load("dnsRollbackBaseline", Math.min(24, maximumAgeHours)));
  const alertEventId = validateAlertEvidence(load("alertDelivery"), stagingTarget);
  validateMemberzoneFallbackEvidence(load("memberzoneFallback", Math.min(24, maximumAgeHours)));
  if (launchMode === "booking_with_stripe") validateStripeUatEvidence(load("stripeUat"), stagingTarget);

  const approvals = objectValue(dossier.approvals, "approvals");
  const uat = requireApproval(approvals, "uat", now, maximumAgeHours);
  exactString(uat.decision, "GO", "approvals.uat.decision");
  if (integerValue(uat.openP0, "approvals.uat.openP0") !== 0 || integerValue(uat.openP1, "approvals.uat.openP1") !== 0) {
    throw new Error("UAT approval must have zero open P0 and P1 findings.");
  }
  requireApprovalAfter(uat, "uat", ["luxartReadOnly", "runtimeProbe", "bookingMutationUat"].map((name) => ({
    label: `artifacts.${name}.checkedAt`,
    timestamp: artifactTimes.get(name)!,
  })));
  const alertReceipt = requireApproval(approvals, "alertReceipt", now, maximumAgeHours);
  trueValue(alertReceipt.confirmed, "approvals.alertReceipt.confirmed");
  exactString(alertReceipt.eventId, alertEventId, "approvals.alertReceipt.eventId");
  requireApprovalAfter(alertReceipt, "alertReceipt", [{
    label: "artifacts.alertDelivery.checkedAt",
    timestamp: artifactTimes.get("alertDelivery")!,
  }]);
  const fallback = requireApproval(approvals, "memberzoneFallback", now, Math.min(24, maximumAgeHours));
  trueValue(fallback.available, "approvals.memberzoneFallback.available");
  requireApprovalAfter(fallback, "memberzoneFallback", [{
    label: "artifacts.memberzoneFallback.checkedAt",
    timestamp: artifactTimes.get("memberzoneFallback")!,
  }]);
  const notifications = requireApproval(approvals, "luxartNotifications", now, maximumAgeHours);
  trueValue(notifications.confirmed, "approvals.luxartNotifications.confirmed");
  requireApprovalAfter(notifications, "luxartNotifications", ["luxartReadOnly", "runtimeProbe"].map((name) => ({
    label: `artifacts.${name}.checkedAt`,
    timestamp: artifactTimes.get(name)!,
  })));
  const cutover = requireApproval(approvals, "cutover", now, Math.min(24, maximumAgeHours));
  trueValue(cutover.approved, "approvals.cutover.approved");
  requireApprovalAfter(cutover, "cutover", [
    ...[...artifactTimes.entries()].map(([name, timestamp]) => ({
      label: `artifacts.${name}.checkedAt`,
      timestamp,
    })),
    ...[
      ["uat", uat],
      ["alertReceipt", alertReceipt],
      ["memberzoneFallback", fallback],
      ["luxartNotifications", notifications],
    ].map(([name, approval]) => ({
      label: `approvals.${name}.approvedAt`,
      timestamp: stringValue((approval as JsonObject).approvedAt, `approvals.${name}.approvedAt`),
    })),
  ]);
  const cutoverApprovedAt = stringValue(cutover.approvedAt, "approvals.cutover.approvedAt");

  return {
    ok: true,
    checkedAt: now.toISOString(),
    cutoverApprovedAt,
    dossierFingerprint: dossierFile.sha256.slice(0, 16),
    releaseId,
    target,
    stagingTarget,
    commit: expectedCommit,
    launchMode,
    paymentsIncluded: launchMode === "booking_with_stripe",
    lessonFeed: {
      count: luxart.count,
      occurrenceSetSha256: luxart.occurrenceSha,
      roomPlacementSetSha256: luxart.roomPlacementSha,
      localizedContentSha256: luxart.localizedContentSha256,
      resourceMapSha256: resources.sha256,
      roomNumbers: luxart.observedRooms,
      reformer: luxart.reformer,
      range: {
        ...luxart.range,
        days: bookingRules.scheduleDays,
        timeZone: zone4YouTimeZone,
      },
      earliestStartsAt: luxart.lessonRange.earliest,
      latestStartsAt: luxart.lessonRange.latest,
      dateKeys: luxart.lessonRange.dateKeys,
    },
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
      luxartNotificationTemplatesConfirmed: true,
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
