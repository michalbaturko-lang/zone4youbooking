import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createRealLuxartAdapter } from "../src/lib/realLuxartAdapter";
import type { Lesson, LuxartAdapter } from "../src/lib/domain";
import { loadLuxartGatewayAuthConfig } from "../src/lib/luxartGatewayAuth";
import { bookingRules } from "../src/lib/bookingRules";
import { zone4YouDateKey, zone4YouScheduleRange, zone4YouTimeZone } from "../src/lib/zone4YouTime";

type Environment = Record<string, string | undefined>;
type AdapterFactory = (context: { userId?: string; locale: "cs" | "en" }) => LuxartAdapter;

interface LuxartReadonlyVerificationOptions {
  environment?: Environment;
  now?: Date;
  adapterFactory?: AdapterFactory;
}

function requireSafeConfiguration(environment: Environment) {
  if (environment.LUXART_MOCK !== "false") {
    throw new Error("Set LUXART_MOCK=false explicitly for the live read-only verification.");
  }
  const rawUrl = environment.LUXART_API_BASE_URL;
  if (!rawUrl) throw new Error("LUXART_API_BASE_URL is required.");
  const url = new URL(rawUrl);
  const insecureTestAllowed = environment.LUXART_ALLOW_INSECURE_TEST_HTTP === "true";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && insecureTestAllowed)) {
    throw new Error("Luxart verification requires HTTPS. Insecure HTTP is allowed only for an explicitly approved test endpoint.");
  }
  return url;
}

function lessonEvidence(lessons: Lesson[], range: { from: string; to: string }) {
  const ids = lessons.map((lesson) => lesson.id).sort();
  if (new Set(ids).size !== lessons.length) throw new Error("Luxart returned duplicate lesson occurrence IDs.");
  const startsAt: string[] = [];
  const dateKeys = new Set<string>();
  const fromDay = range.from.slice(0, 10);
  const toDay = range.to.slice(0, 10);
  for (const lesson of lessons) {
    if (!lesson.id || !lesson.name || !lesson.roomName || !lesson.startsAt || !lesson.endsAt) {
      throw new Error("A Luxart lesson is missing a required mapped display field.");
    }
    const normalizedStart = new Date(lesson.startsAt).toISOString();
    const dayKey = zone4YouDateKey(normalizedStart);
    if (dayKey < fromDay || dayKey >= toDay) {
      throw new Error(`Luxart returned a lesson outside the approved seven-day Prague range: ${dayKey}.`);
    }
    startsAt.push(normalizedStart);
    dateKeys.add(dayKey);
  }
  startsAt.sort();
  const reformer = lessons.filter((lesson) =>
    /reformer/i.test(`${lesson.name} ${lesson.roomName} ${lesson.category}`),
  ).length;
  return {
    count: lessons.length,
    occurrenceSetSha256: createHash("sha256").update(ids.join("\n")).digest("hex"),
    rooms: [...new Set(lessons.map((lesson) => lesson.roomName))].sort(),
    roomNumbers: [...new Set(lessons.map((lesson) => lesson.luxartRoomNumber).filter(Number.isFinite))].sort(),
    reformer,
    earliestStartsAt: startsAt[0],
    latestStartsAt: startsAt.at(-1),
    dateKeys: [...dateKeys].sort(),
  };
}

export function loadLuxartTestCredentials(environment: Environment = process.env) {
  const login = environment.LUXART_TEST_LOGIN?.trim();
  const password = environment.LUXART_TEST_PASSWORD;
  const memberCardNumber = environment.LUXART_TEST_MEMBER_CARD_NUMBER?.trim() || undefined;
  const supplied = [login, password, memberCardNumber].filter(Boolean).length;
  if (supplied > 0 && (!login || !password)) {
    throw new Error("LUXART_TEST_LOGIN and LUXART_TEST_PASSWORD must be supplied together.");
  }
  if (!login || !password) {
    if (environment.LUXART_REQUIRE_AUTHENTICATED_PROBE !== "false") {
      throw new Error(
        "LUXART_TEST_LOGIN and LUXART_TEST_PASSWORD are required for release-grade Luxart verification. " +
        "Set LUXART_REQUIRE_AUTHENTICATED_PROBE=false only for a non-release public-feed diagnostic.",
      );
    }
    return undefined;
  }
  return { login, password, memberCardNumber };
}

export async function runLuxartReadonlyVerification({
  environment = process.env,
  now = new Date(),
  adapterFactory = createRealLuxartAdapter,
}: LuxartReadonlyVerificationOptions = {}) {
  const target = requireSafeConfiguration(environment);
  const gatewayAuth = loadLuxartGatewayAuthConfig(environment);
  const authentication = loadLuxartTestCredentials(environment);
  const query = {
    ...zone4YouScheduleRange(now, bookingRules.scheduleDays),
    resortId: bookingRules.resortId,
  };

  const [czechLessons, englishLessons] = await Promise.all([
    adapterFactory({ locale: "cs" }).getLessons(query),
    adapterFactory({ locale: "en" }).getLessons(query),
  ]);
  const czech = lessonEvidence(czechLessons, query);
  const english = lessonEvidence(englishLessons, query);
  if (czech.count !== english.count || czech.occurrenceSetSha256 !== english.occurrenceSetSha256) {
    throw new Error("Czech and English Luxart feeds do not contain the same lesson occurrences.");
  }
  if (environment.PROBE_REQUIRE_REFORMER !== "false" && czech.reformer === 0) {
    throw new Error("The seven-day Luxart feed contains no Reformer lesson.");
  }

  let authenticatedEvidence: Record<string, unknown> = { checked: false, reason: "test credentials not configured" };
  if (authentication) {
    const loginResult = await adapterFactory({ locale: "cs" }).login(authentication);
    const authenticatedAdapter = adapterFactory({ userId: loginResult.user.id, locale: "cs" });
    const [user, reservations, transactions] = await Promise.all([
      authenticatedAdapter.getCurrentUser(),
      authenticatedAdapter.getReservations(),
      authenticatedAdapter.getCreditTransactions(),
    ]);
    if (!user) throw new Error("Luxart login succeeded but User could not be loaded.");
    authenticatedEvidence = {
      checked: true,
      userLoaded: true,
      reservations: reservations.length,
      creditTransactions: transactions.length,
    };
  }

  return {
    ok: true,
    checkedAt: now.toISOString(),
    target: target.origin,
    gatewayAuthMode: gatewayAuth.mode,
    range: {
      from: query.from,
      to: query.to,
      days: bookingRules.scheduleDays,
      timeZone: zone4YouTimeZone,
    },
    czech,
    english,
    authenticated: authenticatedEvidence,
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runLuxartReadonlyVerification()
    .then((evidence) => console.log(JSON.stringify(evidence, null, 2)))
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Luxart verification failed.",
      }, null, 2));
      process.exitCode = 1;
    });
}
