import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLessonFeedWithinQuery,
  assertLessonFeedReady,
  assertLessonResourceMappingReady,
  assertLiveBookingCreationReady,
  getBookingSnapshotForAdapter,
  pilotLessonQuery,
  queryFromRequest,
} from "../src/lib/bookingService";
import type { Lesson, LuxartAdapter } from "../src/lib/domain";
import { BookingApiError } from "../src/lib/errors";
import { maximumOperationalAmountKc } from "../src/lib/moneyBounds";

function lesson(startsAt: string): Lesson {
  const start = new Date(startsAt).getTime();
  return {
    id: `lesson:${startsAt}`,
    name: "Reformer",
    description: "",
    startsAt,
    endsAt: Number.isNaN(start) ? startsAt : new Date(start + 50 * 60_000).toISOString(),
    durationMinutes: 50,
    instructorName: "Test",
    instructorSpecialization: "",
    roomName: "Reformer",
    category: "Reformer",
    capacity: 6,
    occupiedCount: 0,
    priceKc: 320,
    waitlistEnabled: false,
  };
}

test("pilot lesson query advances at Prague midnight independently of the hosting timezone", () => {
  assert.deepEqual(pilotLessonQuery(new Date("2026-08-30T21:59:59.000Z")), {
    from: "2026-08-30T00:00:00.000Z",
    to: "2026-09-06T00:00:00.000Z",
    resortId: 1,
  });
  assert.deepEqual(pilotLessonQuery(new Date("2026-08-30T22:00:01.000Z")), {
    from: "2026-08-31T00:00:00.000Z",
    to: "2026-09-07T00:00:00.000Z",
    resortId: 1,
  });
});

test("public query parameters cannot change the pilot resort, range or lesson completeness", () => {
  const request = new Request(
    "https://booking.zone4you.cz/api/lessons?resortId=999&from=2035-01-01&to=2036-01-01&roomName=hidden&lessonType=hidden",
  );
  assert.deepEqual(queryFromRequest(request, new Date("2026-01-01T23:30:00.000Z")), {
    from: "2026-01-02T00:00:00.000Z",
    to: "2026-01-09T00:00:00.000Z",
    resortId: 1,
  });
});

test("runtime feed accepts Prague boundary lessons and rejects an eighth calendar day", () => {
  const springQuery = pilotLessonQuery(new Date("2026-03-28T23:30:00.000Z"));
  const autumnQuery = pilotLessonQuery(new Date("2026-10-24T22:30:00.000Z"));

  assert.deepEqual(
    assertLessonFeedWithinQuery([lesson("2026-03-28T23:30:00.000Z")], springQuery).map((item) => item.startsAt),
    ["2026-03-28T23:30:00.000Z"],
  );
  assert.deepEqual(
    assertLessonFeedWithinQuery([lesson("2026-10-24T22:30:00.000Z")], autumnQuery).map((item) => item.startsAt),
    ["2026-10-24T22:30:00.000Z"],
  );
  assert.throws(
    () => assertLessonFeedWithinQuery([lesson("2026-04-04T22:30:00.000Z")], springQuery),
    /mimo schválený sedmidenní rozsah/i,
  );
  assert.throws(
    () => assertLessonFeedWithinQuery([lesson("2026-10-31T23:30:00.000Z")], autumnQuery),
    /mimo schválený sedmidenní rozsah/i,
  );
  assert.throws(
    () => assertLessonFeedWithinQuery([lesson("not-a-date")], springQuery),
    /neplatným časem/i,
  );
});

test("runtime feed rejects ambiguous or structurally invalid Luxart occurrences", () => {
  const query = pilotLessonQuery(new Date("2026-08-30T10:00:00.000Z"));
  const valid = lesson("2026-08-30T10:30:00.000Z");

  assert.throws(
    () => assertLessonFeedWithinQuery([valid, { ...valid }], query),
    /duplicitní identifikátor výskytu/i,
  );
  assert.throws(
    () => assertLessonFeedWithinQuery([{ ...valid, name: "" }], query),
    /neúplnou lekci/i,
  );
  assert.throws(
    () => assertLessonFeedWithinQuery([{ ...valid, endsAt: valid.startsAt }], query),
    /neplatným časem/i,
  );
  for (const invalid of [
    { durationMinutes: 0 },
    { capacity: -1 },
    { occupiedCount: -1 },
    { occupiedCount: 7 },
    { availableCount: -1 },
    { availableCount: 7 },
    { canCurrentUserReserve: "yes" },
    { priceKc: Number.NaN },
    { priceKc: maximumOperationalAmountKc + 1 },
    { waitlistEnabled: undefined },
  ]) {
    assert.throws(
      () => assertLessonFeedWithinQuery([{ ...valid, ...invalid } as Lesson], query),
      /neplatné hodnoty lekce/i,
    );
  }
});

test("snapshot path fails closed before presenting an invalid Luxart feed", async () => {
  const query = pilotLessonQuery(new Date("2026-08-30T10:00:00.000Z"));
  const duplicate = lesson("2026-08-30T10:30:00.000Z");
  const unsupported = async (): Promise<never> => {
    throw new Error("Unexpected adapter call.");
  };
  const adapter: LuxartAdapter = {
    login: unsupported,
    logout: async () => undefined,
    getCurrentUser: async () => null,
    getLessons: async () => [duplicate, { ...duplicate }],
    getReservations: unsupported,
    getWaitlist: unsupported,
    getCreditTransactions: unsupported,
    createReservation: unsupported,
    cancelReservation: unsupported,
    joinWaitlist: unsupported,
    leaveWaitlist: unsupported,
    createTopup: unsupported,
  };

  await assert.rejects(
    getBookingSnapshotForAdapter(adapter, query),
    (error: unknown) =>
      error instanceof Error &&
      "status" in error &&
      error.status === 502 &&
      "code" in error &&
      error.code === "LUXART_RESPONSE_INVALID",
  );
});

test("readiness requires a non-empty but otherwise unfiltered seven-day feed", () => {
  const query = pilotLessonQuery(new Date("2026-08-30T10:00:00.000Z"));
  assert.throws(() => assertLessonFeedReady([], query), (error: unknown) =>
    error instanceof Error &&
    "status" in error &&
    error.status === 503 &&
    "code" in error &&
    error.code === "LUXART_SCHEDULE_EMPTY",
  );
  assert.equal(assertLessonFeedReady([lesson("2026-08-30T10:30:00.000Z")], query).length, 1);
});

test("booking readiness requires an exact resource mapping for every live room", () => {
  const first = { ...lesson("2026-08-30T10:30:00.000Z"), luxartRoomNumber: 2 };
  const second = { ...lesson("2026-08-30T11:30:00.000Z"), luxartRoomNumber: 4 };
  assert.deepEqual(
    assertLessonResourceMappingReady([first, second], JSON.stringify({ 4: 404, 2: 202 })),
    [2, 4],
  );

  for (const mapping of [
    JSON.stringify({ 2: 202 }),
    JSON.stringify({ 2: 202, 4: 404, 7: 707 }),
    JSON.stringify({ 2: 202, 4: 0 }),
    undefined,
  ]) {
    assert.throws(
      () => assertLessonResourceMappingReady([first, second], mapping),
      (error: unknown) =>
        error instanceof BookingApiError &&
        error.status === 503 &&
        error.code === "LUXART_RESOURCE_MAP_MISMATCH",
    );
  }
});

test("booking readiness refuses a live lesson without a positive room number", () => {
  const invalid = { ...lesson("2026-08-30T10:30:00.000Z"), luxartRoomNumber: 0 };
  assert.throws(
    () => assertLessonResourceMappingReady([invalid], JSON.stringify({ 1: 101 })),
    (error: unknown) =>
      error instanceof BookingApiError &&
      error.status === 503 &&
      error.code === "LUXART_RESOURCE_MAP_MISMATCH",
  );
});

test("every new live booking rechecks the complete current room mapping", async () => {
  const query = pilotLessonQuery(new Date("2026-08-30T10:00:00.000Z"));
  const unsupported = async (): Promise<never> => {
    throw new Error("Unexpected adapter call.");
  };
  const lessons = [
    { ...lesson("2026-08-30T10:30:00.000Z"), luxartRoomNumber: 2 },
    { ...lesson("2026-08-30T11:30:00.000Z"), luxartRoomNumber: 4 },
  ];
  let scheduleReads = 0;
  const adapter: LuxartAdapter = {
    login: unsupported,
    logout: async () => undefined,
    getCurrentUser: unsupported,
    getLessons: async () => {
      scheduleReads += 1;
      return lessons;
    },
    getReservations: unsupported,
    getWaitlist: unsupported,
    getCreditTransactions: unsupported,
    createReservation: unsupported,
    cancelReservation: unsupported,
    joinWaitlist: unsupported,
    leaveWaitlist: unsupported,
    createTopup: unsupported,
  };

  assert.deepEqual(
    await assertLiveBookingCreationReady(adapter, query, JSON.stringify({ 2: 202, 4: 404 })),
    [2, 4],
  );
  await assert.rejects(
    assertLiveBookingCreationReady(adapter, query, JSON.stringify({ 2: 202 })),
    (error: unknown) =>
      error instanceof BookingApiError &&
      error.status === 503 &&
      error.code === "LUXART_RESOURCE_MAP_MISMATCH",
  );
  assert.equal(scheduleReads, 2);
});
