import assert from "node:assert/strict";
import test from "node:test";
import { BookingApiError } from "../src/lib/errors";
import { requireLiveBookingMutationSession } from "../src/lib/liveMutationSession";
import type { BookingSession } from "../src/lib/session";

const validSession: BookingSession = {
  version: 1,
  userId: "42",
  issuedAt: 1_700_000_000,
  expiresAt: 1_700_028_800,
};

function mutationRequest() {
  return new Request("https://booking.zone4you.cz/api/reservations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lessonId: "lesson-1" }),
  });
}

function dependencies(calls: string[], session: BookingSession | null, ready = true) {
  return {
    readSession: (_request: Request) => {
      calls.push("read-session");
      return session;
    },
    assertLiveReady: () => {
      calls.push("live-ready");
      if (!ready) {
        throw new BookingApiError(503, "PERSONALIZED_ACCESS_NOT_READY", "Not ready.");
      }
    },
  };
}

test("demo booking mutations bypass the live session and readiness gate", () => {
  const calls: string[] = [];
  const session = requireLiveBookingMutationSession(
    mutationRequest(),
    false,
    dependencies(calls, validSession),
  );

  assert.equal(session, undefined);
  assert.deepEqual(calls, []);
});

test("live booking mutations reject a missing session before consuming the body", () => {
  const calls: string[] = [];
  const request = mutationRequest();

  assert.throws(
    () => requireLiveBookingMutationSession(request, true, dependencies(calls, null)),
    (error: unknown) => error instanceof BookingApiError && error.status === 401 && error.code === "AUTH_REQUIRED",
  );
  assert.deepEqual(calls, ["read-session"]);
  assert.equal(request.bodyUsed, false);
});

test("live readiness failure stops immediately after authenticated session verification", () => {
  const calls: string[] = [];
  const request = mutationRequest();

  assert.throws(
    () => requireLiveBookingMutationSession(request, true, dependencies(calls, validSession, false)),
    (error: unknown) =>
      error instanceof BookingApiError && error.status === 503 && error.code === "PERSONALIZED_ACCESS_NOT_READY",
  );
  assert.deepEqual(calls, ["read-session", "live-ready"]);
  assert.equal(request.bodyUsed, false);
});

test("authenticated live booking mutations pass session then readiness in exact order", () => {
  const calls: string[] = [];
  const session = requireLiveBookingMutationSession(
    mutationRequest(),
    true,
    dependencies(calls, validSession),
  );

  assert.equal(session, validSession);
  assert.deepEqual(calls, ["read-session", "live-ready"]);
});
