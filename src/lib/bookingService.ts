import type { BookingSnapshot, Lesson, LessonQuery, LuxartAdapter } from "./domain";
import { getLuxartAdapter } from "./adapterProvider";
import { bookingRules } from "./bookingRules";
import { BookingApiError } from "./errors";
import { isBoundedKcAmount } from "./moneyBounds";
import { zone4YouDateKey, zone4YouScheduleRange } from "./zone4YouTime";

export function pilotLessonQuery(now = new Date()): LessonQuery {
  return {
    ...zone4YouScheduleRange(now, bookingRules.scheduleDays),
    resortId: bookingRules.resortId,
  };
}

export function queryFromRequest(request: Request, now = new Date()): LessonQuery {
  // The public booking BFF owns pilot scope. URL parameters must not turn it
  // into a proxy for other resorts, dates, rooms or lesson subsets.
  void request;
  return pilotLessonQuery(now);
}

export function assertLessonFeedWithinQuery(lessons: Lesson[], query: LessonQuery) {
  const fromDay = query.from.slice(0, 10);
  const toDay = query.to.slice(0, 10);
  const occurrenceIds = new Set<string>();

  for (const lesson of lessons) {
    const requiredText = [lesson.id, lesson.name, lesson.roomName, lesson.instructorName, lesson.category];
    if (requiredText.some((value) => typeof value !== "string" || !value.trim())) {
      throw new BookingApiError(502, "LUXART_RESPONSE_INVALID", "Luxart vrátil neúplnou lekci.");
    }
    if (
      !Number.isInteger(lesson.durationMinutes) || lesson.durationMinutes <= 0 ||
      !Number.isInteger(lesson.capacity) || lesson.capacity < 0 ||
      !Number.isInteger(lesson.occupiedCount) || lesson.occupiedCount < 0 ||
      lesson.occupiedCount > lesson.capacity ||
      (lesson.availableCount !== undefined && (
        !Number.isInteger(lesson.availableCount) ||
        lesson.availableCount < 0 ||
        lesson.availableCount > lesson.capacity ||
        lesson.occupiedCount + lesson.availableCount > lesson.capacity
      )) ||
      (lesson.canCurrentUserReserve !== undefined && typeof lesson.canCurrentUserReserve !== "boolean") ||
      !isBoundedKcAmount(lesson.priceKc, 0) ||
      typeof lesson.waitlistEnabled !== "boolean"
    ) {
      throw new BookingApiError(502, "LUXART_RESPONSE_INVALID", "Luxart vrátil neplatné hodnoty lekce.");
    }
    if (occurrenceIds.has(lesson.id)) {
      throw new BookingApiError(
        502,
        "LUXART_RESPONSE_INVALID",
        "Luxart vrátil duplicitní identifikátor výskytu lekce.",
      );
    }

    const startsAt = new Date(lesson.startsAt);
    const endsAt = new Date(lesson.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      throw new BookingApiError(502, "LUXART_RESPONSE_INVALID", "Luxart vrátil lekci s neplatným časem.");
    }

    let lessonDay: string;
    try {
      lessonDay = zone4YouDateKey(startsAt);
    } catch {
      throw new BookingApiError(502, "LUXART_RESPONSE_INVALID", "Luxart vrátil lekci s neplatným časem.");
    }
    if (lessonDay < fromDay || lessonDay >= toDay) {
      throw new BookingApiError(
        502,
        "LUXART_RESPONSE_INVALID",
        "Luxart vrátil lekci mimo schválený sedmidenní rozsah.",
      );
    }
    occurrenceIds.add(lesson.id);
  }

  return lessons;
}

export function assertLessonFeedReady(lessons: Lesson[], query: LessonQuery) {
  const validated = assertLessonFeedWithinQuery(lessons, query);
  if (validated.length === 0) {
    throw new BookingApiError(503, "LUXART_SCHEDULE_EMPTY", "Luxart nevrátil žádné lekce pro sedmidenní rozvrh.");
  }
  return validated;
}

export async function getBookingSnapshotForAdapter(
  adapter: LuxartAdapter = getLuxartAdapter(),
  query: LessonQuery = pilotLessonQuery(),
): Promise<BookingSnapshot> {
  const [user, loadedLessons] = await Promise.all([adapter.getCurrentUser(), adapter.getLessons(query)]);
  const lessons = assertLessonFeedWithinQuery(loadedLessons, query);

  if (!user) {
    return {
      user,
      lessons,
      reservations: [],
      waitlist: [],
      transactions: [],
    };
  }

  const [reservations, waitlist, transactions] = await Promise.all([
    adapter.getReservations(),
    adapter.getWaitlist(),
    adapter.getCreditTransactions(),
  ]);

  return {
    user,
    lessons,
    reservations,
    waitlist,
    transactions,
  };
}
