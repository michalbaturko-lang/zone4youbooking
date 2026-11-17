import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { BookingApiError } from "./errors";

export function ok<T>(data: T, init?: ResponseInit) {
  const requestId = randomUUID();
  const headers = new Headers(init?.headers);
  headers.set("X-Request-ID", requestId);
  return NextResponse.json(data, { ...init, headers });
}

export function fail(error: unknown, status = 400) {
  const suppliedRequestId = error instanceof BookingApiError ? new Headers(error.headers).get("X-Request-ID") : null;
  const requestId = suppliedRequestId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedRequestId)
    ? suppliedRequestId : randomUUID();
  if (error instanceof BookingApiError) {
    const headers = new Headers(error.headers);
    headers.set("X-Request-ID", requestId);
    if (error.status >= 500) {
      console.error(JSON.stringify({ event: "booking_api_error", requestId, code: error.code, status: error.status }));
    }
    return NextResponse.json(
      { error: error.message, code: error.code, requestId },
      { status: error.status, headers },
    );
  }
  if (process.env.LUXART_MOCK === "false") {
    console.error(JSON.stringify({ event: "booking_api_error", requestId, code: "REQUEST_FAILED", status }));
    return NextResponse.json(
      { error: "Požadavek se nepodařilo dokončit.", code: "REQUEST_FAILED", requestId },
      { status, headers: { "X-Request-ID": requestId } },
    );
  }
  const message = error instanceof Error ? error.message : "Request failed.";
  return NextResponse.json({ error: message, requestId }, { status, headers: { "X-Request-ID": requestId } });
}
