import assert from "node:assert/strict";
import test from "node:test";
import {
  clientAddress,
  InMemoryFixedWindowRateLimiter,
  rateLimitConfigurationProblems,
  rateLimitKey,
} from "../src/lib/rateLimit";

test("rate limiter rejects requests over the limit and resets at the next window", () => {
  const limiter = new InMemoryFixedWindowRateLimiter();
  const rule = { scope: "test", limit: 2, windowMs: 1_000 };

  assert.equal(limiter.take("client", rule, 0).allowed, true);
  assert.deepEqual(limiter.take("client", rule, 100), {
    allowed: true,
    remaining: 0,
    retryAfterSeconds: 1,
  });
  assert.equal(limiter.take("client", rule, 200).allowed, false);
  assert.equal(limiter.take("client", rule, 1_000).allowed, true);
});

test("rate limiter bounds the number of in-memory client buckets", () => {
  const limiter = new InMemoryFixedWindowRateLimiter(2);
  const rule = { scope: "test", limit: 1, windowMs: 10_000 };

  assert.equal(limiter.take("first", rule, 0).allowed, true);
  assert.equal(limiter.take("second", rule, 0).allowed, true);
  assert.equal(limiter.take("third", rule, 0).allowed, false);
});

test("live rate limiting requires either a confirmed single instance or TLS PostgreSQL", () => {
  assert.deepEqual(rateLimitConfigurationProblems({
    LUXART_MOCK: "false",
    RATE_LIMIT_MODE: "memory",
    RATE_LIMIT_SINGLE_INSTANCE: "false",
  }), ["RATE_LIMIT_SINGLE_INSTANCE"]);

  assert.deepEqual(rateLimitConfigurationProblems({
    LUXART_MOCK: "false",
    RATE_LIMIT_MODE: "postgres",
    RATE_LIMIT_DATABASE_URL: "postgresql://booking.example.com/zone4you?sslmode=require",
  }), []);

  assert.deepEqual(rateLimitConfigurationProblems({
    LUXART_MOCK: "false",
    RATE_LIMIT_MODE: "postgres",
    RATE_LIMIT_DATABASE_URL: "postgresql://localhost/zone4you",
  }), ["RATE_LIMIT_DATABASE_URL"]);
});

test("Vercel rate-limit identity trusts only the validated platform client IP", () => {
  const request = new Request("https://booking.zone4you.cz/api/lessons", {
    headers: {
      "x-vercel-forwarded-for": "203.0.113.10",
      "x-forwarded-for": "198.51.100.20",
      "x-real-ip": "198.51.100.30",
    },
  });
  assert.equal(clientAddress(request, { VERCEL: "1" }), "203.0.113.10");
  assert.equal(clientAddress(request, {}), "198.51.100.20");

  const spoofOnly = new Request("https://booking.zone4you.cz/api/lessons", {
    headers: {
      "x-vercel-forwarded-for": "not-an-ip",
      "x-forwarded-for": "198.51.100.20",
      "x-real-ip": "198.51.100.30",
    },
  });
  assert.equal(clientAddress(spoofOnly, { VERCEL_ENV: "production" }), "unknown");
});

test("login buckets independently bound address spraying and distributed account attacks", () => {
  const request = (address: string) => new Request("https://booking.zone4you.cz/api/auth/login", {
    headers: { "x-forwarded-for": address },
  });
  const addressRule = {
    scope: "auth-login-address",
    limit: 30,
    windowMs: 10 * 60_000,
    keyBy: "address" as const,
  };
  const accountRule = {
    scope: "auth-login-account",
    limit: 15,
    windowMs: 10 * 60_000,
    keyBy: "discriminator" as const,
  };

  assert.equal(
    rateLimitKey(request("203.0.113.10"), addressRule, "first@example.test"),
    rateLimitKey(request("203.0.113.10"), addressRule, "second@example.test"),
  );
  assert.notEqual(
    rateLimitKey(request("203.0.113.10"), addressRule),
    rateLimitKey(request("203.0.113.11"), addressRule),
  );
  assert.equal(
    rateLimitKey(request("203.0.113.10"), accountRule, "Member@Example.Test"),
    rateLimitKey(request("203.0.113.11"), accountRule, "member@example.test"),
  );
  assert.equal(
    rateLimitKey(request("203.0.113.10"), accountRule, "Nováková"),
    rateLimitKey(request("203.0.113.11"), accountRule, "Nováková"),
  );
  assert.notEqual(
    rateLimitKey(request("203.0.113.10"), accountRule, "first@example.test"),
    rateLimitKey(request("203.0.113.10"), accountRule, "second@example.test"),
  );
});
