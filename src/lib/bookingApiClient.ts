import type { BookingCapabilities, BookingRules, BookingSnapshot, LoginInput, PaymentTopup, Reservation, WaitlistEntry } from "./domain";
import type { MockLuxartState } from "./mockLuxart";
import type { Locale } from "./i18n";

export interface BookingSnapshotResponse extends BookingSnapshot {
  rules: BookingRules;
  capabilities: BookingCapabilities;
}

const demoStateStorageKey = "zone4youbooking.demoState";
const readRequestTimeoutMs = 20_000;
const bookingMutationRequestTimeoutMs = 45_000;

export interface BookingApiRequestOptions {
  timeoutMs?: number;
  outcome?: "read" | "booking_mutation";
}

interface StatefulResponse {
  demoState?: MockLuxartState;
}

export class BookingApiClientError extends Error {
  readonly name = "BookingApiClientError";

  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

function readStoredDemoState() {
  if (typeof window === "undefined") return undefined;
  const raw = window.localStorage.getItem(demoStateStorageKey);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as MockLuxartState;
  } catch {
    window.localStorage.removeItem(demoStateStorageKey);
    return undefined;
  }
}

function writeStoredDemoState(json: unknown) {
  if (typeof window === "undefined") return;
  if (!json || typeof json !== "object" || !("demoState" in json)) return;
  const demoState = (json as StatefulResponse).demoState;
  if (!demoState) return;
  window.localStorage.setItem(demoStateStorageKey, JSON.stringify(demoState));
}

function bodyWithDemoState<T extends object>(body?: T) {
  const demoState = readStoredDemoState();
  return JSON.stringify(demoState ? { ...body, demoState } : { ...body });
}

function bookingMutationKey(operation: "reserve" | "cancel") {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${operation}:${uuid}`;
  return `${operation}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

const englishApiErrors: Record<string, string> = {
  AUTH_INVALID: "Sign-in failed. Check your details and try again.",
  INVALID_LOGIN_INPUT: "Enter valid sign-in details.",
  AUTH_REQUIRED: "Please sign in to continue.",
  SESSION_INVALID: "Your session has expired. Please sign in again.",
  INSUFFICIENT_CREDIT: "You do not have enough credit for this booking.",
  RESERVATION_NOT_OPEN: "Booking for this class is not open yet.",
  RESERVATION_CLOSED: "This class can no longer be booked.",
  LESSON_FULL: "This class is full.",
  CLIENT_NOT_ELIGIBLE: "This class is not available for your account.",
  LESSON_ELIGIBILITY_UNKNOWN: "Booking eligibility for this class could not be verified.",
  BOOKING_READ_ONLY: "Booking is temporarily read-only. Reception can help you.",
  RESERVATION_NOT_FOUND: "The booking could not be found.",
  CANCELLATION_REJECTED: "This booking could not be cancelled.",
  CANCELLATION_CLOSED: "Online cancellation for this booking is closed.",
  CANCELLATION_POLICY_UNAVAILABLE: "The cancellation policy for this booking could not be verified safely.",
  BOOKING_RECONCILIATION_REQUIRED: "The result could not be confirmed safely. Do not repeat the action; contact reception.",
  WATCHDOG_DISABLED: "Seat alerts are temporarily unavailable.",
  REQUEST_TIMEOUT: "The request took too long. Check your connection and try again.",
  REQUEST_FAILED: "The service could not be reached. Check your connection and try again.",
};

export function localizedApiErrorMessage(locale: Locale, code?: string, serverMessage?: string) {
  if (locale === "cs") return serverMessage || "Akce se nepodařila.";
  return (code && englishApiErrors[code]) || "The request could not be completed. Please try again.";
}

function clientTransportMessage(locale: Locale, code: string) {
  if (code === "BOOKING_RECONCILIATION_REQUIRED") {
    return locale === "cs"
      ? "Výsledek booking akce nelze bezpečně potvrdit. Akci neopakujte a kontaktujte recepci."
      : englishApiErrors.BOOKING_RECONCILIATION_REQUIRED;
  }
  if (code === "REQUEST_TIMEOUT") {
    return locale === "cs"
      ? "Požadavek trval příliš dlouho. Zkontrolujte připojení a zkuste to znovu."
      : englishApiErrors.REQUEST_TIMEOUT;
  }
  return locale === "cs"
    ? "Službu se nepodařilo kontaktovat. Zkontrolujte připojení a zkuste to znovu."
    : englishApiErrors.REQUEST_FAILED;
}

function boundedTimeout(value: number | undefined, fallback: number) {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 120_000
    ? Number(value)
    : fallback;
}

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
  locale: Locale = "cs",
  options: BookingApiRequestOptions = {},
): Promise<T> {
  const outcome = options.outcome ?? "read";
  const timeoutMs = boundedTimeout(
    options.timeoutMs,
    outcome === "booking_mutation" ? bookingMutationRequestTimeoutMs : readRequestTimeoutMs,
  );
  const controller = new AbortController();
  const upstreamSignal = init?.signal;
  const abortFromUpstream = () => controller.abort();
  if (upstreamSignal?.aborted) controller.abort();
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Zone4You-Locale": locale,
        ...init?.headers,
      },
      signal: controller.signal,
    });
  } catch {
    const code = outcome === "booking_mutation"
      ? "BOOKING_RECONCILIATION_REQUIRED"
      : controller.signal.aborted
        ? "REQUEST_TIMEOUT"
        : "REQUEST_FAILED";
    throw new BookingApiClientError(clientTransportMessage(locale, code), 0, code);
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
  const json = (await response.json().catch(() => ({}))) as unknown;

  if (!response.ok) {
    const payload = typeof json === "object" && json !== null ? json as Record<string, unknown> : {};
    const code = typeof payload.code === "string" ? payload.code : undefined;
    const serverMessage = typeof payload.error === "string" ? payload.error : undefined;
    const message = localizedApiErrorMessage(locale, code, serverMessage);
    const requestId = typeof payload.requestId === "string"
      ? payload.requestId
      : response.headers.get("x-request-id") ?? undefined;
    throw new BookingApiClientError(message, response.status, code, requestId);
  }

  writeStoredDemoState(json);
  return json as T;
}

export const bookingApiClient = {
  snapshot(locale: Locale = "cs") {
    return apiRequest<BookingSnapshotResponse>("/api/booking/snapshot", {
      method: "POST",
      body: bodyWithDemoState(),
    }, locale);
  },

  login(input: LoginInput, locale: Locale = "cs") {
    return apiRequest("/api/auth/login", {
      method: "POST",
      body: bodyWithDemoState(input),
    }, locale);
  },

  logout(locale: Locale = "cs") {
    return apiRequest("/api/auth/logout", {
      method: "POST",
      body: bodyWithDemoState(),
    }, locale);
  },

  createReservation(lessonId: string, locale: Locale = "cs") {
    return apiRequest<{ reservation: Reservation }>("/api/reservations", {
      method: "POST",
      headers: { "Idempotency-Key": bookingMutationKey("reserve") },
      body: bodyWithDemoState({ lessonId }),
    }, locale, { outcome: "booking_mutation" });
  },

  cancelReservation(reservationId: string, locale: Locale = "cs") {
    return apiRequest<{ reservation: Reservation }>(`/api/reservations/${encodeURIComponent(reservationId)}`, {
      method: "DELETE",
      headers: { "Idempotency-Key": bookingMutationKey("cancel") },
      body: bodyWithDemoState(),
    }, locale, { outcome: "booking_mutation" });
  },

  joinWaitlist(lessonId: string, locale: Locale = "cs") {
    return apiRequest<{ waitlistEntry: WaitlistEntry }>("/api/waitlist", {
      method: "POST",
      body: bodyWithDemoState({ lessonId }),
    }, locale);
  },

  leaveWaitlist(waitlistEntryId: string, locale: Locale = "cs") {
    return apiRequest(`/api/waitlist/${encodeURIComponent(waitlistEntryId)}`, {
      method: "DELETE",
      body: bodyWithDemoState(),
    }, locale);
  },

  createTopup(amountKc: number, locale: Locale = "cs") {
    return apiRequest<{ topup: PaymentTopup }>("/api/topups", {
      method: "POST",
      body: bodyWithDemoState({
        amountKc,
      }),
    }, locale);
  },

  createStripeCheckout(amountKc: number, locale: Locale = "cs") {
    return apiRequest<{ checkoutSessionId: string; url: string }>("/api/payments/checkout", {
      method: "POST",
      body: JSON.stringify({ amountKc }),
    }, locale);
  },

  resetDemo() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(demoStateStorageKey);
    }
    return apiRequest("/api/demo/reset", { method: "POST" });
  },
};
