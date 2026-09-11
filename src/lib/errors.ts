export class BookingApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers?: HeadersInit,
  ) {
    super(message);
  }
}

/**
 * The upstream may have accepted a write even though its final response was
 * lost. Callers must reconcile against Luxart instead of retrying the write.
 */
export class BookingMutationOutcomeUnknownError extends BookingApiError {
  constructor(message = "Výsledek změny v Luxartu nelze bezpečně potvrdit. Akci neopakujte a kontaktujte recepci.") {
    super(409, "BOOKING_RECONCILIATION_REQUIRED", message);
  }
}
