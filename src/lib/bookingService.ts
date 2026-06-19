import type { BookingSnapshot, LessonQuery, LuxartAdapter } from "./domain";
import { getLuxartAdapter } from "./adapterProvider";
import { bookingRules } from "./bookingRules";

const dayMs = 24 * 60 * 60 * 1000;

function defaultRange() {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + bookingRules.scheduleDays * dayMs);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function queryFromRequest(request: Request): LessonQuery {
  const url = new URL(request.url);
  const range = defaultRange();

  return {
    from: url.searchParams.get("from") ?? range.from,
    to: url.searchParams.get("to") ?? range.to,
    resortId: Number(url.searchParams.get("resortId") ?? bookingRules.resortId),
    instructorName: url.searchParams.get("instructorName") ?? undefined,
    roomName: url.searchParams.get("roomName") ?? undefined,
    lessonType: url.searchParams.get("lessonType") ?? undefined,
  };
}

export async function getBookingSnapshotForAdapter(
  adapter: LuxartAdapter = getLuxartAdapter(),
  query: LessonQuery = { ...defaultRange(), resortId: bookingRules.resortId },
): Promise<BookingSnapshot> {
  const [user, lessons] = await Promise.all([adapter.getCurrentUser(), adapter.getLessons(query)]);

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
