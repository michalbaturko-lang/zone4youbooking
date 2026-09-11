import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryFixedWindowRateLimiter, rateLimitConfigurationProblems } from "../src/lib/rateLimit";

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
