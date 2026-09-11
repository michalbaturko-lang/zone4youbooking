import type { BookingRules, CancellationPolicy, Lesson } from "./domain";
import implementation from "../../config/booking-rules-implementation.json";
import { zone4YouDateKey, zone4YouStartOfDay, zone4YouTimeZone } from "./zone4YouTime";

export const bookingRules = implementation as BookingRules;

export function isReformerLesson(lesson: Lesson) {
  return [lesson.name, lesson.category, lesson.roomName]
    .some((value) => value?.toUpperCase().includes("REFORMER"));
}

export function cancellationPolicyForLesson(
  lesson: Lesson,
  rules: BookingRules = bookingRules,
): CancellationPolicy {
  if (isReformerLesson(lesson) && rules.reformerCancellation.mode === "custom") {
    const { mode: _mode, ...policy } = rules.reformerCancellation;
    return policy;
  }
  return {
    freeCancellationCutoff: rules.freeCancellationCutoff,
    lateCancelFeeKc: rules.lateCancelFeeKc,
    noShowFeeKc: rules.noShowFeeKc,
    lateCancellationAllowed: rules.lateCancellationAllowed,
  };
}

export function freeCancellationDeadlineForLesson(
  lesson: Lesson,
  rules: BookingRules = bookingRules,
) {
  const cutoff = cancellationPolicyForLesson(lesson, rules).freeCancellationCutoff;
  if (cutoff.mode === "lesson_day_midnight") {
    if (cutoff.timeZone !== zone4YouTimeZone) throw new Error("Unsupported cancellation time zone.");
    return zone4YouStartOfDay(zone4YouDateKey(lesson.startsAt));
  }
  if (!Number.isInteger(cutoff.hours) || cutoff.hours < 1 || cutoff.hours > 31 * 24) {
    throw new Error("Invalid cancellation cutoff hours.");
  }
  const start = new Date(lesson.startsAt).getTime();
  if (!Number.isFinite(start)) throw new Error("Invalid lesson start time.");
  return new Date(start - cutoff.hours * 60 * 60 * 1000).toISOString();
}

export function canCancelLessonAt(
  lesson: Lesson,
  rules: BookingRules = bookingRules,
  now: Date = new Date(),
) {
  const nowTime = now.getTime();
  const startTime = new Date(lesson.startsAt).getTime();
  if (!Number.isFinite(nowTime) || !Number.isFinite(startTime) || nowTime >= startTime) return false;
  const freeUntil = new Date(freeCancellationDeadlineForLesson(lesson, rules)).getTime();
  if (!Number.isFinite(freeUntil)) return false;
  return nowTime < freeUntil || cancellationPolicyForLesson(lesson, rules).lateCancellationAllowed;
}
