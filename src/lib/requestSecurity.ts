import { BookingApiError } from "./errors";
import { isRealLuxartMode } from "./adapterProvider";
import { assertBookingMutationRuntimeReady } from "./bookingMutationConfig";

export function isTrustedMutationOrigin(request: Request, appBaseUrl: string) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(appBaseUrl).origin;
  } catch {
    return false;
  }
}

export function assertTrustedMutation(request: Request) {
  if (!isRealLuxartMode()) return;
  const appBaseUrl = process.env.APP_BASE_URL;
  if (!appBaseUrl || !isTrustedMutationOrigin(request, appBaseUrl)) {
    throw new BookingApiError(403, "UNTRUSTED_ORIGIN", "Požadavek nebyl odeslán z booking aplikace.");
  }
}

export function bookingMutationsEnabled(mode: "demo" | "live", configuredValue?: string) {
  return mode === "demo" || configuredValue === "true";
}

export function assertBookingMutationsEnabled() {
  if (!bookingMutationsEnabled(isRealLuxartMode() ? "live" : "demo", process.env.BOOKING_MUTATIONS_ENABLED)) {
    throw new BookingApiError(
      503,
      "BOOKING_READ_ONLY",
      "Booking je dočasně v režimu pouze pro čtení. Rezervaci vyřeší recepce.",
    );
  }
  if (!isRealLuxartMode()) return;
  assertBookingMutationRuntimeReady();
}

export function readIdempotencyKey(request: Request) {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(key)) {
    throw new BookingApiError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Požadavek rezervace nemá platný bezpečnostní identifikátor. Obnovte stránku a zkuste to znovu.",
    );
  }
  return key;
}
