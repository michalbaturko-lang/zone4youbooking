import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readStableReleaseJson } from "./release-evidence-file";
import { parseLuxartResourceMapping } from "../src/lib/luxartMappings";
import { luxartResourceMappingSha256 } from "../src/lib/luxartResourceMappingFingerprint";

type Environment = Record<string, string | undefined>;

interface ResourceMapVerificationOptions {
  environment?: Environment;
  now?: Date;
  repositoryRoot?: string;
}

function record(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is missing or invalid.`);
  }
  return value as Record<string, unknown>;
}

function canonicalRoomNumbers(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must contain observed Luxart room numbers.`);
  }
  const numbers = value.map((room, index) => {
    if (typeof room !== "number" || !Number.isSafeInteger(room) || room <= 0) {
      throw new Error(`${label}[${index}] must be a positive safe integer.`);
    }
    return room;
  });
  const canonical = [...new Set(numbers)].sort((left, right) => left - right);
  if (JSON.stringify(numbers) !== JSON.stringify(canonical)) {
    throw new Error(`${label} must be unique and canonically sorted.`);
  }
  return canonical;
}

function equalRooms(left: number[], right: number[], label: string) {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(`${label} does not match the authenticated D1 room set.`);
  }
}

function externalEvidencePath(raw: string | undefined, repositoryRoot: string) {
  if (!raw?.trim()) {
    throw new Error("ZONE4YOU_LUXART_EVIDENCE_PATH is required.");
  }
  const path = resolve(raw);
  if (!path.endsWith(".json")) {
    throw new Error("ZONE4YOU_LUXART_EVIDENCE_PATH must end in .json.");
  }
  const fromRepository = relative(resolve(repositoryRoot), path);
  if (fromRepository === "" || (!fromRepository.startsWith("..") && !isAbsolute(fromRepository))) {
    throw new Error("Luxart D1 evidence must be stored outside the repository.");
  }
  return path;
}

function verifiedD1RoomNumbers(data: unknown) {
  const evidence = record(data, "Luxart D1 evidence");
  if (evidence.ok !== true) throw new Error("Luxart D1 evidence is not successful.");

  const d1 = record(evidence.d1, "Luxart D1 attestation");
  if (
    d1.schemaVersion !== 6 ||
    d1.directoryBrowsingChecked !== true ||
    d1.directoryBrowsingDetected !== false ||
    d1.contractBaselineVerified !== true ||
    d1.approvedOriginFingerprintVerified !== true ||
    d1.authenticatedReadOnlyVerified !== true ||
    d1.personalizedLessonSetVerified !== true ||
    d1.loginQueryLoggingConfirmed !== true ||
    typeof d1.loginQueryLoggingConfirmedBy !== "string" ||
    !d1.loginQueryLoggingConfirmedBy.trim() ||
    typeof d1.loginQueryLoggingConfirmedAt !== "string" ||
    !d1.loginQueryLoggingConfirmedAt.trim()
  ) {
    throw new Error("Luxart D1 attestation does not prove the release-grade read-only contract.");
  }

  const czech = record(evidence.czech, "Luxart D1 Czech lesson evidence");
  const english = record(evidence.english, "Luxart D1 English lesson evidence");
  const personalized = record(evidence.personalized, "Luxart D1 personalized evidence");
  if (personalized.checked !== true) {
    throw new Error("Luxart D1 personalized room evidence is not verified.");
  }
  const personalizedCzech = record(personalized.czech, "Luxart D1 personalized Czech evidence");
  const personalizedEnglish = record(personalized.english, "Luxart D1 personalized English evidence");

  const rooms = canonicalRoomNumbers(czech.roomNumbers, "Luxart D1 Czech roomNumbers");
  equalRooms(rooms, canonicalRoomNumbers(english.roomNumbers, "Luxart D1 English roomNumbers"), "English roomNumbers");
  equalRooms(
    rooms,
    canonicalRoomNumbers(personalizedCzech.roomNumbers, "Luxart D1 personalized Czech roomNumbers"),
    "Personalized Czech roomNumbers",
  );
  equalRooms(
    rooms,
    canonicalRoomNumbers(personalizedEnglish.roomNumbers, "Luxart D1 personalized English roomNumbers"),
    "Personalized English roomNumbers",
  );

  const placementDigest = czech.roomPlacementSetSha256;
  if (
    typeof placementDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(placementDigest) ||
    english.roomPlacementSetSha256 !== placementDigest ||
    personalizedCzech.roomPlacementSetSha256 !== placementDigest ||
    personalizedEnglish.roomPlacementSetSha256 !== placementDigest
  ) {
    throw new Error("Luxart D1 room-placement evidence is missing or inconsistent.");
  }
  return rooms;
}

export function verifyLuxartResourceMap({
  environment = process.env,
  now = new Date(),
  repositoryRoot = process.cwd(),
}: ResourceMapVerificationOptions = {}) {
  const evidenceFile = readStableReleaseJson(
    externalEvidencePath(environment.ZONE4YOU_LUXART_EVIDENCE_PATH, repositoryRoot),
    "Luxart D1 evidence",
    { maximumBytes: 256 * 1024, ownerOnly: true },
  );
  const observedRoomNumbers = verifiedD1RoomNumbers(evidenceFile.data);
  if (!environment.LUXART_RESOURCE_MAP_JSON?.trim()) {
    throw new Error(
      `LUXART_RESOURCE_MAP_JSON is required for observed room numbers: ${observedRoomNumbers.join(", ")}.`,
    );
  }
  const mapping = parseLuxartResourceMapping(environment.LUXART_RESOURCE_MAP_JSON);
  const mappedRoomNumbers = Object.keys(mapping).map(Number).sort((left, right) => left - right);
  const observed = new Set(observedRoomNumbers);
  const mapped = new Set(mappedRoomNumbers);
  const missing = observedRoomNumbers.filter((room) => !mapped.has(room));
  const unexpected = mappedRoomNumbers.filter((room) => !observed.has(room));
  if (missing.length > 0) {
    throw new Error(`LUXART_RESOURCE_MAP_JSON is missing observed room numbers: ${missing.join(", ")}.`);
  }
  if (unexpected.length > 0) {
    throw new Error(`LUXART_RESOURCE_MAP_JSON contains unobserved room numbers: ${unexpected.join(", ")}.`);
  }

  return {
    ok: true,
    checkedAt: now.toISOString(),
    d1EvidenceSha256: evidenceFile.sha256,
    observedRoomNumbers,
    observedRoomCount: observedRoomNumbers.length,
    mappedRoomCount: mappedRoomNumbers.length,
    resourceMapSha256: luxartResourceMappingSha256(environment.LUXART_RESOURCE_MAP_JSON),
    resourceIdsExposed: false,
    authorizesMutation: false,
    authorizesCutover: false,
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  try {
    console.log(JSON.stringify(verifyLuxartResourceMap(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Luxart resource map verification failed.",
    }, null, 2));
    process.exitCode = 1;
  }
}
