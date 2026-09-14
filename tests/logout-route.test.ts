import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../src/app/api/auth/logout/route";
import { createBookingSessionToken } from "../src/lib/session";

const target = "https://booking.zone4you.cz/";
const sessionSecret = "test-logout-session-secret-with-32-characters";

function liveLogoutRequest(origin: string) {
  const token = createBookingSessionToken("42", sessionSecret);
  return new Request(`${target}api/auth/logout`, {
    method: "POST",
    headers: {
      origin,
      cookie: `z4y_booking_session=${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
}

function restoreEnvironment(previous: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("trusted live logout clears the local session without Luxart or rate-limit availability", async () => {
  const names = [
    "LUXART_MOCK",
    "APP_BASE_URL",
    "SESSION_SECRET",
    "LUXART_API_BASE_URL",
    "RATE_LIMIT_MODE",
    "RATE_LIMIT_DATABASE_URL",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.LUXART_MOCK = "false";
    process.env.APP_BASE_URL = target;
    process.env.SESSION_SECRET = sessionSecret;
    delete process.env.LUXART_API_BASE_URL;
    delete process.env.RATE_LIMIT_MODE;
    delete process.env.RATE_LIMIT_DATABASE_URL;

    const response = await POST(liveLogoutRequest(target));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /^z4y_booking_session=;/);
    assert.match(setCookie, /; HttpOnly/i);
    assert.match(setCookie, /; Secure/i);
    assert.match(setCookie, /; SameSite=lax/i);
    assert.match(setCookie, /; Max-Age=0/i);
  } finally {
    restoreEnvironment(previous);
  }
});

test("foreign-origin logout is rejected without clearing the session", async () => {
  const names = ["LUXART_MOCK", "APP_BASE_URL", "SESSION_SECRET"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.LUXART_MOCK = "false";
    process.env.APP_BASE_URL = target;
    process.env.SESSION_SECRET = sessionSecret;

    const response = await POST(liveLogoutRequest("https://example.invalid"));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "UNTRUSTED_ORIGIN");
    assert.equal(response.headers.get("set-cookie"), null);
  } finally {
    restoreEnvironment(previous);
  }
});
