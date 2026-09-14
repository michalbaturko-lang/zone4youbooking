import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";

const bookingSessionCookie = "z4y_booking_session";
const sessionTtlSeconds = 8 * 60 * 60;
const maximumSessionTokenLength = 2_048;

function validLuxartUserId(userId: unknown): userId is string {
  return typeof userId === "string" &&
    /^[1-9]\d*$/.test(userId) &&
    Number.isSafeInteger(Number(userId));
}

export interface BookingSession {
  version: 1;
  userId: string;
  issuedAt: number;
  expiresAt: number;
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters in Luxart live mode.");
  }
  return secret;
}

export function createBookingSessionToken(
  userId: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  ttlSeconds = sessionTtlSeconds,
) {
  if (!validLuxartUserId(userId)) throw new Error("Cannot create a booking session without a valid Luxart userId.");
  if (secret.length < 32) throw new Error("Session signing secret is too short.");
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) throw new Error("Session issue time is invalid.");
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > sessionTtlSeconds) {
    throw new Error("Session lifetime is invalid.");
  }

  const session: BookingSession = {
    version: 1,
    userId,
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + ttlSeconds,
  };
  const payload = encode(JSON.stringify(session));
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyBookingSessionToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): BookingSession | null {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > maximumSessionTokenLength ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ||
    secret.length < 32 ||
    !Number.isSafeInteger(nowSeconds) ||
    nowSeconds < 0
  ) {
    return null;
  }
  const [payload, providedSignature, extra] = token.split(".");
  if (!payload || !providedSignature || extra) return null;

  const expected = Buffer.from(signature(payload, secret));
  const provided = Buffer.from(providedSignature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;

  try {
    const session = JSON.parse(decode(payload)) as Partial<BookingSession>;
    const issuedAt = session.issuedAt;
    const expiresAt = session.expiresAt;
    if (
      session.version !== 1 ||
      !validLuxartUserId(session.userId) ||
      typeof issuedAt !== "number" ||
      !Number.isSafeInteger(issuedAt) ||
      issuedAt < 0 ||
      typeof expiresAt !== "number" ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= issuedAt ||
      expiresAt - issuedAt > sessionTtlSeconds ||
      issuedAt > nowSeconds + 60 ||
      expiresAt <= nowSeconds
    ) {
      return null;
    }
    return session as BookingSession;
  } catch {
    return null;
  }
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie");
  if (!cookies) return undefined;
  let matchedValue: string | undefined;
  for (const part of cookies.split(";")) {
    const [cookieName, ...valueParts] = part.trim().split("=");
    if (cookieName !== name) continue;
    if (matchedValue !== undefined) return undefined;
    matchedValue = valueParts.join("=");
  }
  return matchedValue;
}

export function readBookingSession(request: Request) {
  const token = cookieValue(request, bookingSessionCookie);
  if (!token) return null;
  return verifyBookingSessionToken(token, sessionSecret());
}

export function setBookingSession(response: NextResponse, userId: string) {
  response.cookies.set({
    name: bookingSessionCookie,
    value: createBookingSessionToken(userId, sessionSecret()),
    httpOnly: true,
    secure:
      process.env.VERCEL_ENV === "production" ||
      process.env.NEXT_PUBLIC_APP_ENV === "production" ||
      process.env.APP_BASE_URL?.startsWith("https://") === true,
    sameSite: "lax",
    maxAge: sessionTtlSeconds,
    path: "/",
  });
}

export function clearBookingSession(response: NextResponse) {
  response.cookies.set({
    name: bookingSessionCookie,
    value: "",
    httpOnly: true,
    secure:
      process.env.VERCEL_ENV === "production" ||
      process.env.NEXT_PUBLIC_APP_ENV === "production" ||
      process.env.APP_BASE_URL?.startsWith("https://") === true,
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}
