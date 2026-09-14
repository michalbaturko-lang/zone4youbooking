import assert from "node:assert/strict";
import test from "node:test";
import { probeProductionDomain } from "../scripts/probe-production-domain";

const records = [
  { type: "A" as const, address: "203.0.113.10", ttl: 60 },
  { type: "AAAA" as const, address: "2001:db8::10", ttl: 60 },
];

const secureHeaders = {
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
};

test("production domain probe reports a complete candidate without exposing DNS addresses or authorizing cutover", async () => {
  const report = await probeProductionDomain({
    now: new Date("2026-09-12T13:00:00.000Z"),
    resolveRecordsImpl: async () => records,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.protocol === "http:") {
        return new Response(null, { status: 308, headers: { location: "https://booking.zone4you.cz/" } });
      }
      if (url.pathname === "/api/health") {
        return new Response(null, { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(null, { status: 200, headers: secureHeaders });
    },
  });

  assert.equal(report.status, "candidate_ready");
  assert.equal(report.authorizesCutover, false);
  assert.equal(report.http.redirectsToExactHttps, true);
  assert.equal(report.https.frameAncestorsNone, true);
  assert.equal(report.health.jsonContentType, true);
  assert.deepEqual(report.dns.recordTypes, ["A", "AAAA"]);
  assert.equal(JSON.stringify(report).includes("203.0.113.10"), false);
  assert.equal(JSON.stringify(report).includes("2001:db8::10"), false);
});

test("production domain probe stays not ready for wrong redirects and unavailable TLS", async () => {
  const report = await probeProductionDomain({
    resolveRecordsImpl: async () => records,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.protocol === "http:") {
        return new Response(null, { status: 302, headers: { location: "https://example.com/" } });
      }
      throw new TypeError("certificate mismatch with host details that must not escape");
    },
  });

  assert.equal(report.status, "not_ready");
  assert.equal(report.http.redirectsToExactHttps, false);
  assert.equal(report.https.reachable, false);
  assert.equal(report.health.reachable, false);
  assert.equal(JSON.stringify(report).includes("certificate mismatch"), false);
});

test("production domain probe validates timeout bounds and rejects unusable DNS", async () => {
  await assert.rejects(
    probeProductionDomain({
      environment: { ZONE4YOU_DOMAIN_PROBE_TIMEOUT_MS: "999" },
      resolveRecordsImpl: async () => records,
    }),
    /between 1000 and 30000/i,
  );
  await assert.rejects(
    probeProductionDomain({
      resolveRecordsImpl: async () => [{ type: "MX", exchange: "mail.example.com", priority: 10 }],
    }),
    /no A, AAAA or CNAME/i,
  );
});

test("production domain probe does not accept an HSTS disable response", async () => {
  const report = await probeProductionDomain({
    resolveRecordsImpl: async () => records,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.protocol === "http:") {
        return new Response(null, { status: 308, headers: { location: "https://booking.zone4you.cz/" } });
      }
      if (url.pathname === "/api/health") {
        return new Response(null, { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(null, {
        status: 200,
        headers: { ...secureHeaders, "strict-transport-security": "max-age=0" },
      });
    },
  });
  assert.equal(report.https.hsts, false);
  assert.equal(report.status, "not_ready");
});
