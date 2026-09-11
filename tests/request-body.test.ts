import assert from "node:assert/strict";
import test from "node:test";
import { POST as login } from "../src/app/api/auth/login/route";
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

test("login route returns privacy-safe parser errors with a request ID", async () => {
  const previousLuxartMock = process.env.LUXART_MOCK;
  const marker = "private-route-body-marker";
  process.env.LUXART_MOCK = "true";

  try {
    const cases = [
      {
        body: JSON.stringify({ value: "x".repeat(maximumJsonBodyBytes) }),
        status: 413,
        code: "REQUEST_TOO_LARGE",
      },
      {
        body: `{"password":"${marker}"`,
        status: 400,
        code: "INVALID_JSON",
      },
    ];

    for (const current of cases) {
      const response = await login(post(current.body, {
        "content-type": "application/json",
        origin: "https://booking.zone4you.cz",
      }));
      const responseBody = await response.json() as Record<string, unknown>;
      assert.equal(response.status, current.status);
      assert.equal(responseBody.code, current.code);
      assert.equal(typeof responseBody.requestId, "string");
      assert.equal(response.headers.get("x-request-id"), responseBody.requestId);
      assert.equal(JSON.stringify(responseBody).includes(marker), false);
    }
  } finally {
    if (previousLuxartMock === undefined) delete process.env.LUXART_MOCK;
    else process.env.LUXART_MOCK = previousLuxartMock;
  }
});
