import type { BookingRules, BookingSnapshot, LoginInput, PaymentTopup, Reservation, WaitlistEntry } from "./domain";
import type { MockLuxartState } from "./mockLuxart";

export interface BookingSnapshotResponse extends BookingSnapshot {
  rules: BookingRules;
}

const demoStateStorageKey = "zone4youbooking.demoState";

interface StatefulResponse {
  demoState?: MockLuxartState;
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

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const json = (await response.json().catch(() => ({}))) as unknown;

  if (!response.ok) {
    const message =
      typeof json === "object" && json !== null && "error" in json && typeof json.error === "string"
        ? json.error
        : "Akce se nepodařila.";
    throw new Error(message);
  }

  writeStoredDemoState(json);
  return json as T;
}

export const bookingApiClient = {
  snapshot() {
    return apiRequest<BookingSnapshotResponse>("/api/booking/snapshot", {
      method: "POST",
      body: bodyWithDemoState(),
    });
  },

  login(input: LoginInput) {
    return apiRequest("/api/auth/login", {
      method: "POST",
      body: bodyWithDemoState(input),
    });
  },

  logout() {
    return apiRequest("/api/auth/logout", {
      method: "POST",
      body: bodyWithDemoState(),
    });
  },

  createReservation(lessonId: string) {
    return apiRequest<{ reservation: Reservation }>("/api/reservations", {
      method: "POST",
      body: bodyWithDemoState({ lessonId }),
    });
  },

  cancelReservation(reservationId: string) {
    return apiRequest<{ reservation: Reservation }>(`/api/reservations/${encodeURIComponent(reservationId)}`, {
      method: "DELETE",
      body: bodyWithDemoState(),
    });
  },

  joinWaitlist(lessonId: string) {
    return apiRequest<{ waitlistEntry: WaitlistEntry }>("/api/waitlist", {
      method: "POST",
      body: bodyWithDemoState({ lessonId }),
    });
  },

  leaveWaitlist(waitlistEntryId: string) {
    return apiRequest(`/api/waitlist/${encodeURIComponent(waitlistEntryId)}`, {
      method: "DELETE",
      body: bodyWithDemoState(),
    });
  },

  createTopup(amountKc: number) {
    return apiRequest<{ topup: PaymentTopup }>("/api/topups", {
      method: "POST",
      body: bodyWithDemoState({
        amountKc,
        provider: "stripe",
        idempotencyKey: `demo-${amountKc}-${Date.now()}`,
      }),
    });
  },

  resetDemo() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(demoStateStorageKey);
    }
    return apiRequest("/api/demo/reset", { method: "POST" });
  },
};
