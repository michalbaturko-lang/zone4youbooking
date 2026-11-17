import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../src/app/api/reservations/route";
import { POST as waitlist } from "../src/app/api/waitlist/route";

test("reservation and watchdog reject non-string lesson IDs with a stable safe error", async (context) => {
  const previous = process.env.LUXART_MOCK;
  process.env.LUXART_MOCK = "true";
  context.after(() => { if (previous === undefined) delete process.env.LUXART_MOCK; else process.env.LUXART_MOCK = previous; });
  for (const handler of [POST, waitlist]) {
    for (const lessonId of [12, [], {}, true, null, "x".repeat(257), "\nprivate-marker", " padded "]) {
      const response = await handler(new Request("https://booking.example/api/reservations", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "test-invalid" },
        body: JSON.stringify({ lessonId }),
      }));
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.equal(body.code, "INVALID_LESSON_ID");
      assert.equal(JSON.stringify(body).includes("private-marker"), false);
    }
  }
});
