import { createHash } from "node:crypto";
import type { Reservation } from "./domain";
import type {
  BookingMutationOperation,
  DurableBookingMutationLedger,
} from "./bookingMutationLedger";
import { BookingApiError, BookingMutationOutcomeUnknownError } from "./errors";

function requestFingerprint(operation: BookingMutationOperation, targetId: string) {
  return createHash("sha256").update(`${operation}\0${targetId}`, "utf8").digest("hex");
}

function validReservationForMutation(
  value: unknown,
  userId: string,
  operation: BookingMutationOperation,
  targetId: string,
): value is Reservation {
  if (!value || typeof value !== "object") return false;
  const reservation = value as Partial<Reservation>;
  const shapeValid = (
    typeof reservation.id === "string" &&
    reservation.userId === userId &&
    typeof reservation.lessonId === "string" &&
    ["active", "cancelled", "attended", "no_show"].includes(reservation.status ?? "") &&
    typeof reservation.reservedAt === "string" &&
    !Number.isNaN(new Date(reservation.reservedAt).getTime()) &&
    typeof reservation.priceKc === "number" &&
    Number.isFinite(reservation.priceKc)
  );
  if (!shapeValid) return false;
  if (operation === "create_reservation") {
    return reservation.status === "active" && reservation.lessonId === targetId;
  }
  const targetMatches = reservation.id === targetId ||
    (targetId.startsWith("uuid:") && reservation.luxartUuid === targetId.slice(5));
  return reservation.status === "cancelled" && targetMatches;
}

export async function processBookingMutation(input: {
  ledger: DurableBookingMutationLedger;
  userId: string;
  idempotencyKey: string;
  operation: BookingMutationOperation;
  targetId: string;
  mutate(): Promise<Reservation>;
}) {
  const lease = await input.ledger.acquire<Reservation>({
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    operation: input.operation,
    targetId: input.targetId,
    requestFingerprint: requestFingerprint(input.operation, input.targetId),
  });

  try {
    if (lease.claim === "in_progress") {
      throw new BookingApiError(
        409,
        "BOOKING_ALREADY_PROCESSING",
        "Předchozí booking akce se ještě zpracovává. Vyčkejte na obnovení stavu.",
        { "Retry-After": "3" },
      );
    }
    if (lease.claim === "uncertain") {
      throw new BookingApiError(
        409,
        "BOOKING_RECONCILIATION_REQUIRED",
        "Výsledek předchozí booking akce je nejistý. Akci neopakujte a kontaktujte recepci.",
      );
    }
    if (lease.claim === "rejected") {
      if (!lease.error) {
        throw new BookingApiError(409, "BOOKING_LEDGER_STATE_INVALID", "Uložený výsledek booking akce není platný.");
      }
      throw new BookingApiError(lease.error.status, lease.error.code, lease.error.message);
    }
    if (lease.claim === "applied") {
      if (!validReservationForMutation(lease.response, input.userId, input.operation, input.targetId)) {
        throw new BookingApiError(409, "BOOKING_LEDGER_STATE_INVALID", "Uložená rezervace není platná.");
      }
      return { reservation: lease.response, replayed: true };
    }

    let reservation: Reservation;
    try {
      reservation = await input.mutate();
    } catch (error) {
      if (error instanceof BookingMutationOutcomeUnknownError) {
        await lease.markUncertain("LUXART_OUTCOME_UNKNOWN");
      } else if (error instanceof BookingApiError && error.status >= 400 && error.status < 500) {
        await lease.markRejected({ status: error.status, code: error.code, message: error.message });
      } else {
        await lease.discard();
      }
      throw error;
    }

    if (!validReservationForMutation(reservation, input.userId, input.operation, input.targetId)) {
      await lease.markUncertain("LUXART_RESULT_MISMATCH");
      throw new BookingApiError(
        409,
        "BOOKING_RECONCILIATION_REQUIRED",
        "Luxart vrátil nejednoznačný výsledek booking akce. Akci neopakujte a kontaktujte recepci.",
      );
    }

    try {
      await lease.markApplied(reservation);
    } catch {
      await lease.markUncertain("LEDGER_FINALIZATION_FAILED").catch(() => undefined);
      throw new BookingApiError(
        409,
        "BOOKING_RECONCILIATION_REQUIRED",
        "Luxart změnu zpracoval, ale aplikace ji nedokázala bezpečně potvrdit. Akci neopakujte a kontaktujte recepci.",
      );
    }
    return { reservation, replayed: false };
  } finally {
    await lease.release();
  }
}
