import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { Lesson, LuxartAdapter, User } from "../src/lib/domain";
import { validateLuxartEvidence } from "../scripts/verify-pilot-release";
import {
  loadLuxartTestCredentials,
  runLuxartReadonlyVerification,
} from "../scripts/verify-luxart-readonly";
import {
  approvedLuxartReferenceSemanticContractSha256,
  luxartPublicContractEndpoints,
} from "../scripts/verify-luxart-public-contract";

const now = new Date("2026-09-05T08:00:00.000Z");
const target = "https://luxart-test.example.com:9191";
const environment = {
  LUXART_MOCK: "false",
  LUXART_API_CONTRACT: "memberzone_rest_v1",
  LUXART_API_BASE_URL: `${target}/`,
  LUXART_API_AUTH_MODE: "none",
  LUXART_TEST_LOGIN: "release-test-user",
  LUXART_TEST_PASSWORD: "release-test-password",
} satisfies Record<string, string | undefined>;

test("release-grade Luxart verification requires a complete test login by default", () => {
  assert.throws(() => loadLuxartTestCredentials({}), /required for release-grade/i);
  assert.throws(
    () => loadLuxartTestCredentials({ LUXART_TEST_MEMBER_CARD_NUMBER: "123" }),
    /must be supplied together/i,
  );
  assert.equal(
    loadLuxartTestCredentials({ LUXART_REQUIRE_AUTHENTICATED_PROBE: "false" }),
    undefined,
  );
});

test("HTTP diagnostics reject gateway authentication before creating an adapter", async () => {
  let adapterCreated = false;
  await assert.rejects(
    runLuxartReadonlyVerification({
      environment: {
        ...environment,
        LUXART_API_BASE_URL: "http://luxart-test.example.com:9295/",
        LUXART_ALLOW_INSECURE_TEST_HTTP: "true",
        LUXART_API_AUTH_MODE: "basic",
        LUXART_API_BASIC_USERNAME: "gateway-user",
        LUXART_API_BASIC_PASSWORD: "gateway-password",
        LUXART_REQUIRE_AUTHENTICATED_PROBE: "false",
      },
      adapterFactory: () => {
        adapterCreated = true;
        throw new Error("Adapter must not be created.");
      },
    }),
    /gateway credentials will not be sent over HTTP/i,
  );
  assert.equal(adapterCreated, false);
});

test("authenticated Luxart verification never sends test credentials over HTTP", async () => {
  let adapterCreated = false;
  await assert.rejects(
    runLuxartReadonlyVerification({
      environment: {
        ...environment,
        LUXART_API_BASE_URL: "http://luxart-test.example.com:9295/",
        LUXART_ALLOW_INSECURE_TEST_HTTP: "true",
      },
      now,
      adapterFactory: () => {
        adapterCreated = true;
        throw new Error("The adapter must not be created for authenticated HTTP verification.");
      },
    }),
    /requires HTTPS/i,
  );
  assert.equal(adapterCreated, false);
});

test("standalone Luxart evidence remains diagnostic while D1-attested evidence satisfies the release contract", async () => {
  const user: User = {
    id: "42",
    login: "release-test-user",
    fullName: "Release Test User",
    email: "release-test@example.invalid",
    creditBalanceKc: 500,
  };
  const lesson = (locale: "cs" | "en"): Lesson => ({
    id: "luxart:1:4:321:2026-09-05T10:00:00.000Z",
    luxartRoomNumber: 4,
    name: locale === "cs" ? "Reformer základy" : "Reformer Basics",
    description: "",
    startsAt: "2026-09-05T10:00:00.000Z",
    endsAt: "2026-09-05T11:00:00.000Z",
    durationMinutes: 60,
    instructorName: "Test Instructor",
    instructorSpecialization: "Pilates",
    roomName: "Reformer",
    category: "Reformer",
    capacity: 8,
    occupiedCount: 2,
    canCurrentUserReserve: true,
    priceKc: 200,
    waitlistEnabled: false,
  });
  const adapterFactory = ({ userId, locale }: { userId?: string; locale: "cs" | "en" }) => {
    const unused = async () => { throw new Error("Unexpected adapter mutation in read-only verification test."); };
    return {
      getLessons: async () => [lesson(locale)],
      login: async () => ({ user }),
      logout: async () => undefined,
      getCurrentUser: async () => userId === user.id ? user : null,
      getReservations: async () => [],
      getWaitlist: async () => [],
      getCreditTransactions: async () => [],
      createReservation: unused,
      cancelReservation: unused,
      joinWaitlist: unused,
      leaveWaitlist: async () => undefined,
      createTopup: unused,
    } satisfies LuxartAdapter;
  };

  const evidence = await runLuxartReadonlyVerification({ environment, now, adapterFactory });
  assert.throws(
    () => validateLuxartEvidence(evidence, target, new Map([["4", 204]]), "none"),
    /luxartReadOnly\.d1 must be a JSON object/i,
  );
  validateLuxartEvidence({
    ...evidence,
    d1: {
      schemaVersion: 3,
      checkedAt: now.toISOString(),
      targetFingerprintSha256: createHash("sha256").update(target).digest("hex"),
      helpClassification: "ready",
      helpTransport: "https",
      helpPort: "9191",
      helpHttpStatus: 200,
      helpBodySha256: "b".repeat(64),
      gatewayAuthMode: "none",
      apiContract: "memberzone_rest_v1",
      contractCheckedAt: now.toISOString(),
      contractEndpointCount: luxartPublicContractEndpoints.length,
      contractSemanticSha256: approvedLuxartReferenceSemanticContractSha256,
      contractBaselineVerified: true,
      approvedOriginFingerprintVerified: true,
      authenticatedReadOnlyVerified: true,
      personalizedLessonSetVerified: true,
    },
  }, target, new Map([["4", 204]]), "none");

  assert.equal(evidence.ok, true);
  assert.equal(evidence.authenticated.checked, true);
  assert.equal(evidence.czech.count, 1);
  assert.equal(evidence.czech.reformer, 1);
  assert.equal(evidence.czech.occurrenceSetSha256, evidence.english.occurrenceSetSha256);
  assert.equal(evidence.czech.roomPlacementSetSha256, evidence.english.roomPlacementSetSha256);
  assert.notEqual(evidence.czech.lessonContentSetSha256, evidence.english.lessonContentSetSha256);
  assert.deepEqual(evidence.czech.roomNumbers, [4]);
  assert.equal(evidence.personalized.checked, true);
  if (evidence.personalized.checked) {
    assert.equal(evidence.personalized.czech.count, 1);
    assert.equal(evidence.personalized.czech.eligible, 1);
    assert.equal(evidence.personalized.czech.ineligible, 0);
    assert.equal(evidence.personalized.czech.occurrenceSetSha256, evidence.czech.occurrenceSetSha256);
    assert.equal(evidence.personalized.czech.roomPlacementSetSha256, evidence.czech.roomPlacementSetSha256);
    assert.equal(evidence.personalized.czech.lessonContentSetSha256, evidence.czech.lessonContentSetSha256);
    assert.equal(evidence.personalized.english.lessonContentSetSha256, evidence.english.lessonContentSetSha256);
    assert.equal(evidence.personalized.english.eligible, evidence.personalized.czech.eligible);
  }
  assert.equal(JSON.stringify(evidence).includes("release-test-password"), false);

  const missingEligibilityFactory = (context: { userId?: string; locale: "cs" | "en" }) => ({
    ...adapterFactory(context),
    getLessons: async () => [{
      ...lesson(context.locale),
      canCurrentUserReserve: context.userId ? undefined : true,
    }],
  } satisfies LuxartAdapter);
  await assert.rejects(
    runLuxartReadonlyVerification({ environment, now, adapterFactory: missingEligibilityFactory }),
    /authenticated Luxart lesson did not provide a binary user_posible/i,
  );

  const hiddenPersonalizedLessonFactory = (context: { userId?: string; locale: "cs" | "en" }) => ({
    ...adapterFactory(context),
    getLessons: async () => context.userId ? [] : [lesson(context.locale)],
  } satisfies LuxartAdapter);
  await assert.rejects(
    runLuxartReadonlyVerification({ environment, now, adapterFactory: hiddenPersonalizedLessonFactory }),
    /does not contain the complete anonymous Luxart lesson set/i,
  );
});
