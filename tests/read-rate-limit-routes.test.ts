import assert from "node:assert/strict";
import test from "node:test";
import { GET as getSnapshot, POST as postSnapshot } from "../src/app/api/booking/snapshot/route";
import { GET as getTransactions } from "../src/app/api/credit/transactions/route";
import { GET as getLessons } from "../src/app/api/lessons/route";
import { GET as getReservations } from "../src/app/api/reservations/route";
import { GET as getWaitlist } from "../src/app/api/waitlist/route";

test("live Luxart read routes fail closed before upstream access when shared rate limiting is unavailable", async () => {
  const previous = {
    luxartMock: process.env.LUXART_MOCK,
    rateLimitMode: process.env.RATE_LIMIT_MODE,
  };
  process.env.LUXART_MOCK = "false";
  delete process.env.RATE_LIMIT_MODE;

  const request = (path: string, method: "GET" | "POST" = "GET") => new Request(
    `https://booking.zone4you.cz${path}`,
    {
      method,
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "192.0.2.10" },
      ...(method === "POST" ? { body: "{}" } : {}),
    },
  );

  try {
    const responses = await Promise.all([
      getLessons(request("/api/lessons")),
      getSnapshot(request("/api/booking/snapshot")),
      postSnapshot(request("/api/booking/snapshot", "POST")),
      getReservations(request("/api/reservations")),
      getWaitlist(request("/api/waitlist")),
      getTransactions(request("/api/credit/transactions")),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, "RATE_LIMIT_NOT_READY");
      assert.ok(response.headers.get("x-request-id"));
    }
  } finally {
    if (previous.luxartMock === undefined) delete process.env.LUXART_MOCK;
    else process.env.LUXART_MOCK = previous.luxartMock;
    if (previous.rateLimitMode === undefined) delete process.env.RATE_LIMIT_MODE;
    else process.env.RATE_LIMIT_MODE = previous.rateLimitMode;
  }
});
