import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { zone4YouScheduleRange } from "../src/lib/zone4YouTime";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repositoryRoot, "scripts", "probe-runtime.mjs");
const commit = "1234567890abcdef1234567890abcdef12345678";

function runProbe(port: number) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        APP_BASE_URL: `http://127.0.0.1:${port}`,
        PROBE_ALLOW_SINGLE_INSTANCE: "true",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function apiResponse(response: import("node:http").ServerResponse, body: unknown) {
  response.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Request-ID": "runtime-probe-test",
  });
  response.end(JSON.stringify(body));
}

test("runtime probe verifies the same lesson occurrences through Czech and English app routes", async () => {
  const observedLocales: string[] = [];
  const expectedRange = zone4YouScheduleRange(new Date(), 7);
  let lessonStartsAt = new Date(new Date(expectedRange.from).getTime() + 10 * 60 * 60_000).toISOString();
  let readinessSchedule = "ready";
  let readinessRegion = "fra1";
  let bookingNotifications = "ready";
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, {
        "Content-Security-Policy": "frame-ancestors 'none'",
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
        "X-Content-Type-Options": "nosniff",
      });
      response.end("ok");
      return;
    }
    if (request.url === "/api/health") {
      apiResponse(response, { status: "ok" });
      return;
    }
    if (request.url === "/api/readiness") {
      apiResponse(response, {
        status: "ready",
        mode: "live",
        phase: "booking_without_payments",
        commit,
        region: readinessRegion,
        luxart: "reachable",
        schedule: readinessSchedule,
        bookingNotifications,
        rateLimit: "memory",
        booking: "ready",
        payments: "disabled",
        capabilities: {},
      });
      return;
    }
    if (request.url === "/api/lessons") {
      const locale = String(request.headers["x-zone4you-locale"] ?? "");
      observedLocales.push(locale);
      apiResponse(response, {
        lessons: [{
          id: "lesson-1",
          name: locale === "en" ? "Reformer Basics" : "Reformer základy",
          roomName: "Reformer",
          category: "Reformer",
          startsAt: lessonStartsAt,
        }],
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const result = await runProbe(address.port);
    assert.equal(result.code, 0, result.stderr);
    const evidence = JSON.parse(result.stdout) as {
      checks: {
        readiness: {
          region: string;
          schedule: string;
          bookingNotifications: string;
          booking: string;
          payments: string;
        };
        lessons: {
          range: { from: string; to: string; days: number; timeZone: string };
          czech: { occurrenceSetSha256: string };
          english: { occurrenceSetSha256: string };
        };
      };
    };
    assert.deepEqual(observedLocales.sort(), ["cs", "en"]);
    assert.equal(evidence.checks.readiness.schedule, "ready");
    assert.equal(evidence.checks.readiness.bookingNotifications, "ready");
    assert.equal(evidence.checks.readiness.region, "fra1");
    assert.equal(evidence.checks.readiness.booking, "ready");
    assert.equal(evidence.checks.readiness.payments, "disabled");
    assert.deepEqual(evidence.checks.lessons.range, {
      ...expectedRange,
      days: 7,
      timeZone: "Europe/Prague",
    });
    assert.equal(
      evidence.checks.lessons.czech.occurrenceSetSha256,
      evidence.checks.lessons.english.occurrenceSetSha256,
    );

    lessonStartsAt = new Date(new Date(expectedRange.to).getTime() + 10 * 60 * 60_000).toISOString();
    const outOfRange = await runProbe(address.port);
    assert.equal(outOfRange.code, 1);
    assert.match(outOfRange.stderr, /outside the seven-day Prague range/i);

    lessonStartsAt = new Date(new Date(expectedRange.from).getTime() + 10 * 60 * 60_000).toISOString();
    readinessSchedule = "empty";
    const emptyReadiness = await runProbe(address.port);
    assert.equal(emptyReadiness.code, 1);
    assert.match(emptyReadiness.stderr, /does not confirm a valid non-empty seven-day Luxart schedule/i);

    readinessSchedule = "ready";
    bookingNotifications = "unconfirmed";
    const unconfirmedNotifications = await runProbe(address.port);
    assert.equal(unconfirmedNotifications.code, 1);
    assert.match(unconfirmedNotifications.stderr, /does not confirm active Luxart booking notification templates/i);

    bookingNotifications = "ready";
    readinessRegion = "iad1";
    const wrongRegion = await runProbe(address.port);
    assert.equal(wrongRegion.code, 1);
    assert.match(wrongRegion.stderr, /does not prove the approved fra1 deployment region/i);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
