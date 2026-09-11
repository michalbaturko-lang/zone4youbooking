import assert from "node:assert/strict";
import test from "node:test";
import type { BookingCapabilities, BookingRules, Lesson, Reservation, User } from "../src/lib/domain";
import {
  loadBookingMutationUatConfig,
  redactUatSecrets,
  runBookingMutationUat,
} from "../scripts/verify-booking-mutations";
import { validateBookingUatEvidence } from "../scripts/verify-pilot-release";

const target = "https://staging.booking.zone4you.cz/";
const commit = "1234567890abcdef1234567890abcdef12345678";
const baseEnvironment = {
  ZONE4YOU_UAT_APP_URL: target,
  ZONE4YOU_UAT_MUTATION_CONFIRMATION: "ZONE4YOU_TEST_DB_ONLY:https://staging.booking.zone4you.cz",
  ZONE4YOU_UAT_EXPECTED_COMMIT: commit,
  ZONE4YOU_UAT_EXPECTED_PHASE: "booking_without_payments",
  ZONE4YOU_UAT_LOGIN: "approved-test-user",
  ZONE4YOU_UAT_PASSWORD: "test-secret",
  ZONE4YOU_UAT_EXPECTED_USER_ID: "42",
  ZONE4YOU_UAT_LESSON_ID: "luxart:1:12:321:2026-09-01T14:30:00.000Z",
  ZONE4YOU_UAT_EXPECTED_CANCELLATION_FEE_KC: "0",
  ZONE4YOU_UAT_MIN_HOURS_BEFORE_START: "4",
} satisfies Record<string, string | undefined>;

test("mutation UAT configuration refuses production and stale confirmations", () => {
  assert.throws(
    () => loadBookingMutationUatConfig({ ...baseEnvironment, ZONE4YOU_UAT_APP_URL: "https://booking.zone4you.cz/" }),
    /production/i,
  );
  assert.throws(
    () => loadBookingMutationUatConfig({ ...baseEnvironment, ZONE4YOU_UAT_MUTATION_CONFIRMATION: "YES" }),
    /exactly equal/i,
  );
  assert.throws(
    () => loadBookingMutationUatConfig({
      ...baseEnvironment,
      ZONE4YOU_UAT_APP_URL: "https://example.com/",
      ZONE4YOU_UAT_MUTATION_CONFIRMATION: "ZONE4YOU_TEST_DB_ONLY:https://example.com",
    }),
    /staging-named/i,
  );
  assert.throws(
    () => loadBookingMutationUatConfig({ ...baseEnvironment, ZONE4YOU_UAT_EXPECTED_COMMIT: "latest" }),
    /full 40-character Git SHA/i,
  );
  assert.throws(
    () => loadBookingMutationUatConfig({ ...baseEnvironment, ZONE4YOU_UAT_EXPECTED_PHASE: "read_only" }),
    /booking_without_payments or booking_with_stripe/i,
  );
  assert.equal(loadBookingMutationUatConfig(baseEnvironment).target.origin, "https://staging.booking.zone4you.cz");
});

test("mutation UAT error evidence redacts test credentials", () => {
  assert.equal(
    redactUatSecrets("approved-test-user failed with test-secret", baseEnvironment),
    "[redacted] failed with [redacted]",
  );
});

test("guarded UAT proves replay, concurrency and restored state without exposing credentials", async () => {
  const config = loadBookingMutationUatConfig(baseEnvironment);
  const user: User = {
    id: "42",
    login: "approved-test-user",
    fullName: "Approved Test User",
    email: "test@example.invalid",
    creditBalanceKc: 1000,
  };
  const lesson: Lesson = {
    id: config.lessonId,
    luxartRoomNumber: 1,
    name: "UAT lesson",
    description: "",
    startsAt: new Date(Date.now() + 30 * 3_600_000).toISOString(),
    endsAt: new Date(Date.now() + 31 * 3_600_000).toISOString(),
    durationMinutes: 60,
    instructorName: "Test",
    instructorSpecialization: "Test",
    roomName: "Sál 1",
    category: "Test",
    capacity: 10,
    occupiedCount: 2,
    availableCount: 8,
    canCurrentUserReserve: true,
    priceKc: 180,
    waitlistEnabled: false,
  };
  const rules: BookingRules = {
    resortId: 1,
    scheduleDays: 7,
    freeCancellationCutoff: {
      mode: "lesson_day_midnight",
      timeZone: "Europe/Prague",
    },
    lateCancelFeeKc: 100,
    noShowFeeKc: 100,
    lateCancellationAllowed: true,
    reformerCancellation: { mode: "same_as_group" },
    minimumCreditForReservationKc: 200,
    reservationHoldKc: 100,
    reservationWindowHours: 48,
    topupAmounts: [500],
  };
  const capabilities: BookingCapabilities = {
    reservationsEnabled: true,
    waitlistEnabled: false,
    topupsEnabled: false,
    topupMode: "disabled",
    businessRulesStatus: "confirmed",
    favoritesSync: "device",
    forgotPasswordEnabled: false,
    englishEnabled: true,
  };
  let reservations: Reservation[] = [];
  let createWrites = 0;
  let cancelWrites = 0;
  let cancelledReservation: Reservation | undefined;
  let personalizedEligibility = true;
  let authoritativeAvailableCount = 8;
  let readinessCommit = commit;
  let sequence = 0;
  const idempotentResponses = new Map<string, Reservation>();

  const response = (body: unknown, status = 200, extraHeaders: HeadersInit = {}) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-ID": `req-${sequence += 1}`, ...extraHeaders },
  });
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const headers = new Headers(init?.headers);
    if (url.pathname === "/api/readiness") {
      return response({
        status: "ready",
        mode: "live",
        phase: "booking_without_payments",
        commit: readinessCommit,
        region: "fra1",
        luxart: "reachable",
        schedule: "ready",
        booking: "ready",
        payments: "disabled",
        capabilities,
      });
    }
    if (url.pathname === "/api/auth/login") {
      const rawBody = String(init?.body ?? "");
      assert.ok(rawBody.includes("test-secret"));
      return response({ user }, 200, { "Set-Cookie": "z4y_booking_session=test-cookie; HttpOnly; Path=/" });
    }
    assert.equal(headers.get("cookie"), "z4y_booking_session=test-cookie");
    if (url.pathname === "/api/booking/snapshot") {
      return response({
        user,
        lessons: [{
          ...lesson,
          canCurrentUserReserve: personalizedEligibility,
          availableCount: authoritativeAvailableCount,
        }],
        reservations,
        rules,
        capabilities,
      });
    }
    if (url.pathname === "/api/reservations" && init?.method === "POST") {
      const key = headers.get("idempotency-key")!;
      const stored = idempotentResponses.get(key) ?? reservations[0];
      if (stored) {
        idempotentResponses.set(key, stored);
        return response({ reservation: stored });
      }
      createWrites += 1;
      const created: Reservation = {
        id: "987",
        userId: user.id,
        lessonId: lesson.id,
        status: "active",
        reservedAt: new Date().toISOString(),
        priceKc: lesson.priceKc,
      };
      reservations = [created];
      idempotentResponses.set(key, created);
      return response({ reservation: created }, 201);
    }
    if (url.pathname === "/api/reservations/987" && init?.method === "DELETE") {
      const key = headers.get("idempotency-key")!;
      const stored = idempotentResponses.get(key);
      if (stored?.status === "cancelled") return response({ reservation: stored });
      if (cancelledReservation) {
        idempotentResponses.set(key, cancelledReservation);
        return response({ reservation: cancelledReservation });
      }
      cancelWrites += 1;
      const cancelled: Reservation = {
        ...(reservations[0] ?? { id: "987", userId: user.id, lessonId: lesson.id, reservedAt: new Date().toISOString(), priceKc: 180 }),
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
        cancellationFeeKc: 0,
      };
      reservations = [];
      cancelledReservation = cancelled;
      idempotentResponses.set(key, cancelled);
      return response({ reservation: cancelled });
    }
    return response({ code: "NOT_FOUND", error: "not found" }, 404);
  };

  const evidence = await runBookingMutationUat(config, fakeFetch);
  validateBookingUatEvidence(
    evidence,
    config.target.origin,
    new Map([["1", 101]]),
    config.expectedCommit,
    config.expectedPhase,
  );
  assert.equal(evidence.ok, true);
  assert.equal(evidence.deploymentProvenanceVerified, true);
  assert.equal(evidence.commit, commit);
  assert.equal(evidence.phase, "booking_without_payments");
  assert.equal(evidence.region, "fra1");
  assert.equal(evidence.personalizedEligibilityVerified, true);
  assert.equal(evidence.authoritativeAvailabilityVerified, true);
  assert.equal(evidence.reservationWindowVerified, true);
  assert.equal(evidence.onlineCancellationVerified, true);
  assert.equal(evidence.lessonRoomNumber, 1);
  assert.equal(evidence.finalStateRestored, true);
  assert.equal(createWrites, 1);
  assert.equal(cancelWrites, 1);
  assert.equal(JSON.stringify(evidence).includes("test-secret"), false);
  assert.equal(JSON.stringify(evidence).includes("approved-test-user"), false);

  const writesAfterSuccessfulUat = createWrites;
  personalizedEligibility = false;
  await assert.rejects(
    runBookingMutationUat(config, fakeFetch),
    /not explicitly eligible.*no mutation was attempted/i,
  );
  assert.equal(createWrites, writesAfterSuccessfulUat);

  personalizedEligibility = true;
  authoritativeAvailableCount = 0;
  await assert.rejects(
    runBookingMutationUat(config, fakeFetch),
    /no authoritative available place.*no mutation was attempted/i,
  );
  assert.equal(createWrites, writesAfterSuccessfulUat);

  authoritativeAvailableCount = 8;
  readinessCommit = "b".repeat(40);
  await assert.rejects(
    runBookingMutationUat(config, fakeFetch),
    /exact approved ready live staging runtime/i,
  );
  assert.equal(createWrites, writesAfterSuccessfulUat);
});
