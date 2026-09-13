import { fail, ok } from "@/lib/apiResponse";
import { getRequestLuxartAdapter, isRealLuxartMode } from "@/lib/adapterProvider";
import { getPostgresBookingMutationLedger } from "@/lib/bookingMutationLedger";
import { processBookingMutation } from "@/lib/bookingMutationProcessor";
import { readJsonWithDemoState, withDemoState } from "@/lib/demoStateTransport";
import { BookingApiError } from "@/lib/errors";
import { assertBookingMutationsEnabled, assertTrustedMutation, readIdempotencyKey } from "@/lib/requestSecurity";
import { assertRateLimit, rateLimitRules } from "@/lib/rateLimit";
import { readBookingSession } from "@/lib/session";
import { assertLiveBookingCreationReady } from "@/lib/bookingService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await assertRateLimit(request, rateLimitRules.accountRead);
    const reservations = await getRequestLuxartAdapter(request).getReservations();
    return ok(withDemoState({ reservations }));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    assertBookingMutationsEnabled();
    const body = await readJsonWithDemoState<{ lessonId?: string }>(request);
    if (!body.lessonId || body.lessonId.length > 256) {
      throw new BookingApiError(400, "INVALID_LESSON_ID", "Lekci se nepodařilo identifikovat.");
    }
    const idempotencyKey = readIdempotencyKey(request);
    await assertRateLimit(request, rateLimitRules.reservationCreate, body.lessonId);
    const adapter = getRequestLuxartAdapter(request);
    if (!isRealLuxartMode()) {
      const reservation = await adapter.createReservation({ lessonId: body.lessonId });
      return ok(withDemoState({ reservation }), { status: 201 });
    }

    const session = readBookingSession(request);
    if (!session) throw new BookingApiError(401, "AUTH_REQUIRED", "Pro tuto akci se přihlaste.");
    await assertLiveBookingCreationReady(adapter);
    const ledger = getPostgresBookingMutationLedger();
    await ledger.assertReady();
    const result = await processBookingMutation({
      ledger,
      userId: session.userId,
      idempotencyKey,
      operation: "create_reservation",
      targetId: body.lessonId,
      mutate: () => adapter.createReservation({ lessonId: body.lessonId! }),
    });
    return ok(withDemoState(result), { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return fail(error);
  }
}
