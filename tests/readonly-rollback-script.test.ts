import assert from "node:assert/strict";
import test from "node:test";
import {
  loadReadonlyRollbackConfig,
  runReadonlyRollbackDrill,
} from "../scripts/verify-readonly-rollback";
import { validateRollbackEvidence } from "../scripts/verify-pilot-release";

const target = "https://booking.zone4you.cz/";
const baseEnvironment = {
  ZONE4YOU_ROLLBACK_APP_URL: target,
  ZONE4YOU_ROLLBACK_CONFIRMATION: "READ_ONLY_ROLLBACK:https://booking.zone4you.cz",
} satisfies Record<string, string | undefined>;

test("rollback configuration requires an exact target confirmation and secure origin", () => {
  assert.throws(
    () => loadReadonlyRollbackConfig({ ...baseEnvironment, ZONE4YOU_ROLLBACK_CONFIRMATION: "YES" }),
    /exactly equal/i,
  );
  assert.throws(
    () => loadReadonlyRollbackConfig({
      ...baseEnvironment,
      ZONE4YOU_ROLLBACK_APP_URL: "http://booking.zone4you.cz/",
      ZONE4YOU_ROLLBACK_CONFIRMATION: "READ_ONLY_ROLLBACK:http://booking.zone4you.cz",
    }),
    /requires HTTPS/i,
  );
  assert.equal(loadReadonlyRollbackConfig(baseEnvironment).maxDurationMs, 300_000);
});

test("rollback drill proves read-only schedule and every client mutation brake", async () => {
  const config = loadReadonlyRollbackConfig(baseEnvironment);
  let sequence = 0;
  const requests: string[] = [];
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-ID": `rollback-${sequence += 1}` },
  });
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
    assert.equal(new Headers(init?.headers).get("origin"), "https://booking.zone4you.cz");
    if (url.pathname === "/api/health") return response({ status: "ok" });
    if (url.pathname === "/api/readiness") {
      return response({
        status: "ready",
        mode: "live",
        luxart: "reachable",
        booking: "read_only",
        payments: "disabled",
        capabilities: {
          reservationsEnabled: false,
          waitlistEnabled: false,
          topupsEnabled: false,
          topupMode: "disabled",
        },
      });
    }
    if (url.pathname === "/api/booking/snapshot") return response({ lessons: [{ id: "safe-read" }] });
    if (url.pathname === "/api/payments/checkout") {
      return response({ code: "PAYMENTS_DISABLED" }, 503);
    }
    return response({ code: "BOOKING_READ_ONLY" }, 503);
  };

  const evidence = await runReadonlyRollbackDrill(config, fakeFetch);
  validateRollbackEvidence(evidence, config.target.origin);
  assert.equal(evidence.ok, true);
  assert.equal(evidence.lessonCount, 1);
  assert.equal(evidence.requestIds.length, 7);
  assert.deepEqual(requests, [
    "GET /api/health",
    "GET /api/readiness",
    "GET /api/booking/snapshot",
    "POST /api/reservations",
    "DELETE /api/reservations/rollback-drill-noop",
    "POST /api/waitlist",
    "POST /api/payments/checkout",
  ]);
});

test("rollback drill fails closed when a mutation brake is not active", async () => {
  const config = loadReadonlyRollbackConfig(baseEnvironment);
  let sequence = 0;
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-ID": `unsafe-${sequence += 1}` },
  });
  const fakeFetch: typeof fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.pathname === "/api/health") return response({ status: "ok" });
    if (url.pathname === "/api/readiness") {
      return response({
        status: "ready",
        mode: "live",
        luxart: "reachable",
        booking: "read_only",
        payments: "disabled",
        capabilities: {
          reservationsEnabled: false,
          waitlistEnabled: false,
          topupsEnabled: false,
          topupMode: "disabled",
        },
      });
    }
    if (url.pathname === "/api/booking/snapshot") return response({ lessons: [{ id: "safe-read" }] });
    if (url.pathname === "/api/reservations") return response({ code: "AUTH_REQUIRED" }, 401);
    return response({ code: "BOOKING_READ_ONLY" }, 503);
  };

  await assert.rejects(
    runReadonlyRollbackDrill(config, fakeFetch),
    /was not blocked by BOOKING_READ_ONLY/i,
  );
});
