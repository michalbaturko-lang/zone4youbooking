import assert from "node:assert/strict";
import test from "node:test";
import { POST as createReservation } from "../src/app/api/reservations/route";
import { DELETE as cancelReservation } from "../src/app/api/reservations/[reservationId]/route";
import { POST as joinWaitlist } from "../src/app/api/waitlist/route";

test("live read-only routes reject every booking mutation before request-specific processing", async () => {
  const previous = {
    luxartMock: process.env.LUXART_MOCK,
    appBaseUrl: process.env.APP_BASE_URL,
    bookingMutations: process.env.BOOKING_MUTATIONS_ENABLED,
  };
  process.env.LUXART_MOCK = "false";
  process.env.APP_BASE_URL = "https://booking.zone4you.cz/";
  process.env.BOOKING_MUTATIONS_ENABLED = "false";

  const request = (path: string, method: "POST" | "DELETE") => new Request(
    new URL(path, process.env.APP_BASE_URL),
    {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: "https://booking.zone4you.cz",
      },
      body: "{}",
    },
  );

  try {
    const responses = await Promise.all([
      createReservation(request("/api/reservations", "POST")),
      cancelReservation(request("/api/reservations/rollback-drill-noop", "DELETE"), {
        params: Promise.resolve({ reservationId: "rollback-drill-noop" }),
      }),
      joinWaitlist(request("/api/waitlist", "POST")),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, "BOOKING_READ_ONLY");
      assert.ok(response.headers.get("x-request-id"));
    }
  } finally {
    if (previous.luxartMock === undefined) delete process.env.LUXART_MOCK;
    else process.env.LUXART_MOCK = previous.luxartMock;
    if (previous.appBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previous.appBaseUrl;
    if (previous.bookingMutations === undefined) delete process.env.BOOKING_MUTATIONS_ENABLED;
    else process.env.BOOKING_MUTATIONS_ENABLED = previous.bookingMutations;
  }
});
