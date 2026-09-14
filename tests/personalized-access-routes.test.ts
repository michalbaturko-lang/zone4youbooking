import assert from "node:assert/strict";
import test from "node:test";
import { POST as login } from "../src/app/api/auth/login/route";
import { getRequestLuxartAdapter } from "../src/lib/adapterProvider";
import { BookingApiError } from "../src/lib/errors";
import { createBookingSessionToken } from "../src/lib/session";

const managedEnvironmentKeys = [
  "LUXART_MOCK",
  "APP_BASE_URL",
  "SESSION_SECRET",
] as const;

function captureEnvironment() {
  return Object.fromEntries(managedEnvironmentKeys.map((key) => [key, process.env[key]]));
}

function restoreEnvironment(previous: Record<string, string | undefined>) {
  for (const key of managedEnvironmentKeys) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("live login is rejected before credentials are read when deployment preflight is red", async () => {
  const previous = captureEnvironment();
  process.env.LUXART_MOCK = "false";
  process.env.APP_BASE_URL = "https://staging.booking.zone4you.cz/";

  const request = new Request("https://staging.booking.zone4you.cz/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://staging.booking.zone4you.cz",
    },
    body: JSON.stringify({ login: "must-not-be-read", password: "must-not-be-read" }),
  });

  try {
    const response = await login(request);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "PERSONALIZED_ACCESS_NOT_READY");
    assert.equal(request.bodyUsed, false);
  } finally {
    restoreEnvironment(previous);
  }
});

test("an existing live session cannot bypass a red deployment preflight", () => {
  const previous = captureEnvironment();
  const secret = "test-only-session-secret-at-least-32-characters";
  process.env.LUXART_MOCK = "false";
  process.env.APP_BASE_URL = "https://staging.booking.zone4you.cz/";
  process.env.SESSION_SECRET = secret;
  const token = createBookingSessionToken("123", secret);
  const request = new Request("https://staging.booking.zone4you.cz/api/lessons", {
    headers: { Cookie: `z4y_booking_session=${token}` },
  });

  try {
    assert.throws(
      () => getRequestLuxartAdapter(request),
      (error: unknown) =>
        error instanceof BookingApiError &&
        error.status === 503 &&
        error.code === "PERSONALIZED_ACCESS_NOT_READY",
    );
  } finally {
    restoreEnvironment(previous);
  }
});
