import type { BookingCapabilities, BookingRules, BookingSnapshot, LoginInput, PaymentTopup, Reservation, WaitlistEntry } from "./domain";
import type { MockLuxartState } from "./mockLuxart";
import type { Locale } from "./i18n";

export interface BookingSnapshotResponse extends BookingSnapshot {
  rules: BookingRules;
  capabilities: BookingCapabilities;
}

const demoStateStorageKey = "zone4youbooking.demoState";

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
  BOOKING_READ_ONLY: "Booking is temporarily read-only. Reception can help you.",
  RESERVATION_NOT_FOUND: "The booking could not be found.",
  CANCELLATION_REJECTED: "This booking could not be cancelled.",
  CANCELLATION_CLOSED: "Online cancellation for this booking is closed.",
  CANCELLATION_POLICY_UNAVAILABLE: "The cancellation policy for this booking could not be verified safely.",
  BOOKING_RECONCILIATION_REQUIRED: "The result could not be confirmed safely. Do not repeat the action; contact reception.",
  WATCHDOG_DISABLED: "Seat alerts are temporarily unavailable.",
};

export function localizedApiErrorMessage(locale: Locale, code?: string, serverMessage?: string) {
  if (locale === "cs") return serverMessage || "Akce se nepodařila.";
  return (code && englishApiErrors[code]) || "The request could not be completed. Please try again.";
}

async function apiRequest<T>(path: string, init?: RequestInit, locale: Locale = "cs"): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Zone4You-Locale": locale,
      ...init?.headers,
    },
  });
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
    }, locale);
  },

  cancelReservation(reservationId: string, locale: Locale = "cs") {
    return apiRequest<{ reservation: Reservation }>(`/api/reservations/${encodeURIComponent(reservationId)}`, {
      method: "DELETE",
      headers: { "Idempotency-Key": bookingMutationKey("cancel") },
      body: bodyWithDemoState(),
    }, locale);
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
