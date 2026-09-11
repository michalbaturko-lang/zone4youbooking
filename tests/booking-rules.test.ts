import assert from "node:assert/strict";
import test from "node:test";
import {
  availablePlacesForLesson,
  bookingRules,
  cancellationPolicyForLesson,
  canCancelLessonAt,
  freeCancellationDeadlineForLesson,
  isReformerLesson,
} from "../src/lib/bookingRules";
import type { BookingRules, Lesson } from "../src/lib/domain";

function lesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: "lesson-1",
    name: "PUMPING",
    description: "Test lesson",
    startsAt: "2026-09-12T17:30:00.000Z",
    endsAt: "2026-09-12T18:30:00.000Z",
    durationMinutes: 60,
    instructorName: "Test Instructor",
    instructorSpecialization: "Test",
    roomName: "Sál 1",
    category: "Síla",
    capacity: 10,
    occupiedCount: 2,
    priceKc: 200,
    waitlistEnabled: false,
    ...overrides,
  };
}

function customReformerRules(overrides: Partial<BookingRules["reformerCancellation"]> = {}): BookingRules {
  return {
    ...bookingRules,
    reformerCancellation: {
      mode: "custom",
      freeCancellationCutoff: { mode: "hours_before_start", hours: 24 },
      lateCancelFeeKc: 320,
      noShowFeeKc: 320,
      lateCancellationAllowed: false,
      ...overrides,
    },
  };
}

test("Reformer can use its own bounded hours-before-start cancellation policy", () => {
  const reformer = lesson({ name: "REFORMER", roomName: "Reformer", category: "Reformer" });
  const rules = customReformerRules();

  assert.equal(isReformerLesson(reformer), true);
  assert.equal(freeCancellationDeadlineForLesson(reformer, rules), "2026-09-11T17:30:00.000Z");
  assert.deepEqual(cancellationPolicyForLesson(reformer, rules), {
    freeCancellationCutoff: { mode: "hours_before_start", hours: 24 },
    lateCancelFeeKc: 320,
    noShowFeeKc: 320,
    lateCancellationAllowed: false,
  });
  assert.equal(canCancelLessonAt(reformer, rules, new Date("2026-09-11T17:29:59.999Z")), true);
  assert.equal(canCancelLessonAt(reformer, rules, new Date("2026-09-11T17:30:00.000Z")), false);
});

test("late online cancellation follows the selected lesson policy and never passes the lesson start", () => {
  const group = lesson();
  const reformer = lesson({ name: "REFORMER", roomName: "Reformer", category: "Reformer" });
  const rules = customReformerRules({ lateCancellationAllowed: true });

  assert.equal(canCancelLessonAt(group, rules, new Date("2026-09-12T12:00:00.000Z")), true);
  assert.equal(canCancelLessonAt(reformer, rules, new Date("2026-09-12T12:00:00.000Z")), true);
  assert.equal(canCancelLessonAt(reformer, rules, new Date(reformer.startsAt)), false);
});

test("Luxart reported availability takes precedence over capacity arithmetic", () => {
  const quotaRestricted = lesson({
    capacity: 10,
    occupiedCount: 6,
    availableCount: 1,
  });
  assert.equal(availablePlacesForLesson(quotaRestricted), 1);
  assert.equal(availablePlacesForLesson({ ...quotaRestricted, availableCount: undefined }), 4);
});
