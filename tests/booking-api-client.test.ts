import assert from "node:assert/strict";
import test from "node:test";
import {
  BookingApiClientError,
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
