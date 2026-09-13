import { fail, ok } from "@/lib/apiResponse";
import { getRequestLuxartAdapter, isRealLuxartMode } from "@/lib/adapterProvider";
import { getPostgresBookingMutationLedger } from "@/lib/bookingMutationLedger";
import { processBookingMutation } from "@/lib/bookingMutationProcessor";
import { readJsonWithDemoState, withDemoState } from "@/lib/demoStateTransport";
import { BookingApiError } from "@/lib/errors";
import { requireLiveBookingMutationSession } from "@/lib/liveMutationSession";
import { assertBookingMutationsEnabled, assertTrustedMutation, readIdempotencyKey } from "@/lib/requestSecurity";
import { assertRateLimit, rateLimitRules } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ reservationId: string }> }) {
  try {
    assertTrustedMutation(request);
    assertBookingMutationsEnabled();
    const live = isRealLuxartMode();
    const session = requireLiveBookingMutationSession(request, live);
    await readJsonWithDemoState(request);
    const { reservationId } = await context.params;
    if (!reservationId || reservationId.length > 128) {
      throw new BookingApiError(400, "INVALID_RESERVATION_ID", "Rezervaci se nepodařilo identifikovat.");
    }
    const idempotencyKey = readIdempotencyKey(request);
    await assertRateLimit(request, rateLimitRules.reservationCancel, reservationId);
    const adapter = getRequestLuxartAdapter(request);
    if (!live) {
      const reservation = await adapter.cancelReservation({ reservationId });
      return ok(withDemoState({ reservation }));
    }

    const ledger = getPostgresBookingMutationLedger();
    await ledger.assertReady();
    const result = await processBookingMutation({
      ledger,
      userId: session!.userId,
      idempotencyKey,
      operation: "cancel_reservation",
      targetId: reservationId,
      mutate: () => adapter.cancelReservation({ reservationId }),
    });
    return ok(withDemoState(result));
  } catch (error) {
    return fail(error);
  }
}
