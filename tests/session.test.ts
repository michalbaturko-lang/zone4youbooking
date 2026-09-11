import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import {
  clearBookingSession,
  createBookingSessionToken,
  readBookingSession,
  setBookingSession,
  verifyBookingSessionToken,
} from "../src/lib/session";

const secret = "test-session-secret-with-at-least-32-characters";

test("creates and verifies a short-lived signed booking session", () => {
  const token = createBookingSessionToken("42", secret, 1_000, 600);
  const session = verifyBookingSessionToken(token, secret, 1_100);

  assert.equal(session?.userId, "42");
  assert.equal(session?.issuedAt, 1_000);
  assert.equal(session?.expiresAt, 1_600);
});

test("rejects tampered and expired booking sessions", () => {
  const token = createBookingSessionToken("42", secret, 1_000, 60);
  const [payload, signature] = token.split(".");

  assert.equal(verifyBookingSessionToken(`${payload}x.${signature}`, secret, 1_010), null);
  assert.equal(verifyBookingSessionToken(token, secret, 1_060), null);
});

test("production session cookie is secure, readable by the server and explicitly cleared", (context) => {
  const originalSessionSecret = process.env.SESSION_SECRET;
  const originalAppBaseUrl = process.env.APP_BASE_URL;
  context.after(() => {
    if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSessionSecret;
    if (originalAppBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalAppBaseUrl;
  });

  process.env.SESSION_SECRET = secret;
  process.env.APP_BASE_URL = "https://booking.zone4you.cz/";

  const loginResponse = NextResponse.json({ ok: true });
  setBookingSession(loginResponse, "42");
  const setCookie = loginResponse.headers.get("set-cookie") ?? "";

  assert.match(setCookie, /^z4y_booking_session=[^;]+;/);
  assert.match(setCookie, /; HttpOnly/i);
  assert.match(setCookie, /; Secure/i);
  assert.match(setCookie, /; SameSite=lax/i);
  assert.match(setCookie, /; Path=\//i);
  assert.match(setCookie, /; Max-Age=28800/i);

  const token = setCookie.match(/^z4y_booking_session=([^;]+)/)?.[1];
  assert.ok(token);
  const authenticatedRequest = new Request("https://booking.zone4you.cz/api/booking/snapshot", {
    headers: { cookie: `z4y_booking_session=${token}` },
  });
  assert.equal(readBookingSession(authenticatedRequest)?.userId, "42");

  const logoutResponse = NextResponse.json({ ok: true });
  clearBookingSession(logoutResponse);
  const clearedCookie = logoutResponse.headers.get("set-cookie") ?? "";
  assert.match(clearedCookie, /^z4y_booking_session=;/);
  assert.match(clearedCookie, /; HttpOnly/i);
  assert.match(clearedCookie, /; Secure/i);
  assert.match(clearedCookie, /; SameSite=lax/i);
  assert.match(clearedCookie, /; Max-Age=0/i);
});
