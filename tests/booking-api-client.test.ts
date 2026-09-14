import assert from "node:assert/strict";
import test from "node:test";
import {
  BookingApiClientError,
  apiRequest,
  bookingApiClient,
  localizedApiErrorMessage,
} from "../src/lib/bookingApiClient";

test("English mode never leaks a Czech server error", () => {
  assert.equal(
    localizedApiErrorMessage("en", "SESSION_INVALID", "Přihlášení vypršelo."),
    "Your session has expired. Please sign in again.",
  );
  assert.equal(
    localizedApiErrorMessage("en", "UNMAPPED_UPSTREAM_ERROR", "Česká chyba z Luxartu."),
    "The request could not be completed. Please try again.",
  );
});

test("browser API errors retain the privacy-safe status, code and correlation ID", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: "Přihlášení vypršelo. Přihlaste se znovu.",
    code: "SESSION_INVALID",
    requestId: "request-safe-123",
  }), {
    status: 401,
    headers: { "Content-Type": "application/json", "X-Request-ID": "request-header-fallback" },
  });

  await assert.rejects(
    bookingApiClient.createReservation("lesson-safe"),
    (error: unknown) => {
      assert.ok(error instanceof BookingApiClientError);
      assert.equal(error.status, 401);
      assert.equal(error.code, "SESSION_INVALID");
      assert.equal(error.requestId, "request-safe-123");
      assert.equal(error.message, "Přihlášení vypršelo. Přihlaste se znovu.");
      return true;
    },
  );
});

test("browser reads time out into a retryable localized transport error", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  let aborted = false;
  globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) {
      reject(new Error("Expected a bounded browser request signal."));
      return;
    }
    signal.addEventListener("abort", () => {
      aborted = true;
      reject(new DOMException("Request aborted", "AbortError"));
    }, { once: true });
  });

  await assert.rejects(
    apiRequest("/api/booking/snapshot", { method: "POST" }, "en", { timeoutMs: 5 }),
    (error: unknown) => {
      assert.ok(error instanceof BookingApiClientError);
      assert.equal(error.status, 0);
      assert.equal(error.code, "REQUEST_TIMEOUT");
      assert.match(error.message, /took too long/i);
      return true;
    },
  );
  assert.equal(aborted, true);
});

test("lost booking responses are always reported as uncertain and must not invite a blind retry", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  let idempotencyKey = "";
  globalThis.fetch = async (_input, init) => {
    idempotencyKey = new Headers(init?.headers).get("Idempotency-Key") ?? "";
    throw new TypeError("connection lost after request transmission");
  };

  await assert.rejects(
    bookingApiClient.cancelReservation("reservation-safe", "en"),
    (error: unknown) => {
      assert.ok(error instanceof BookingApiClientError);
      assert.equal(error.status, 0);
      assert.equal(error.code, "BOOKING_RECONCILIATION_REQUIRED");
      assert.match(error.message, /do not repeat/i);
      return true;
    },
  );
  assert.match(idempotencyKey, /^cancel:/);
});
