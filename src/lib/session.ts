import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";

const bookingSessionCookie = "z4y_booking_session";
const sessionTtlSeconds = 8 * 60 * 60;

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
  if (!userId) throw new Error("Cannot create a booking session without userId.");
  if (secret.length < 32) throw new Error("Session signing secret is too short.");

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
  const [payload, providedSignature, extra] = token.split(".");
  if (!payload || !providedSignature || extra) return null;

  const expected = Buffer.from(signature(payload, secret));
  const provided = Buffer.from(providedSignature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;

  try {
    const session = JSON.parse(decode(payload)) as Partial<BookingSession>;
    if (
      session.version !== 1 ||
      typeof session.userId !== "string" ||
      !session.userId ||
      typeof session.issuedAt !== "number" ||
      typeof session.expiresAt !== "number" ||
      session.issuedAt > nowSeconds + 60 ||
      session.expiresAt <= nowSeconds
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
  for (const part of cookies.split(";")) {
    const [cookieName, ...valueParts] = part.trim().split("=");
    if (cookieName === name) return decodeURIComponent(valueParts.join("="));
  }
  return undefined;
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
