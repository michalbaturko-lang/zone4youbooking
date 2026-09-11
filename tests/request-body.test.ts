import assert from "node:assert/strict";
import test from "node:test";
import { BookingApiError } from "../src/lib/errors";
import {
  maximumJsonBodyBytes,
  readBoundedJson,
} from "../src/lib/requestBody";

function post(body?: BodyInit, headers: HeadersInit = {}) {
  return new Request("https://booking.zone4you.cz/api/test", {
    method: "POST",
    headers,
    body,
  });
}

test("bounded JSON reader accepts a small object and an empty mutation body", async () => {
  assert.deepEqual(
    await readBoundedJson(post(JSON.stringify({ lessonId: "lesson-1" }))),
    { lessonId: "lesson-1" },
  );
  assert.deepEqual(await readBoundedJson(post()), {});
  assert.deepEqual(await readBoundedJson(post("   ")), {});
});

test("bounded JSON reader rejects declared and streamed oversized bodies with a stable 413", async () => {
  const requests = [
    post("{}", { "content-length": String(maximumJsonBodyBytes + 1) }),
    post(JSON.stringify({ value: "x".repeat(maximumJsonBodyBytes) })),
  ];

  for (const request of requests) {
    await assert.rejects(
      readBoundedJson(request),
      (error: unknown) => error instanceof BookingApiError &&
        error.status === 413 &&
        error.code === "REQUEST_TOO_LARGE",
    );
  }
});

test("bounded JSON reader rejects malformed JSON without reflecting its contents", async () => {
  const marker = "private-body-marker";
  await assert.rejects(
    readBoundedJson(post(`{"value":"${marker}"`)),
    (error: unknown) => error instanceof BookingApiError &&
      error.status === 400 &&
      error.code === "INVALID_JSON" &&
      !error.message.includes(marker),
  );
});
