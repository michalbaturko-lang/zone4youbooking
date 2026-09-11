import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";
import { PostgresFixedWindowRateLimiter } from "../src/lib/rateLimit";

const connectionString = process.env.RATE_LIMIT_TEST_DATABASE_URL;
if (!connectionString) throw new Error("RATE_LIMIT_TEST_DATABASE_URL is required for the PostgreSQL rate-limit integration test.");

test("PostgreSQL rate limiter atomically enforces one shared window across connections", async () => {
  const schema = `z4y_rate_limit_test_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString, max: 1 });
  const pool = new Pool({ connectionString, max: 4, options: `-c search_path=${schema}` });
  const migration = await readFile(join(process.cwd(), "migrations/003_rate_limit.sql"), "utf8");
  const limiter = new PostgresFixedWindowRateLimiter(pool);
  const rule = { scope: "integration", limit: 3, windowMs: 60_000 };

  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await pool.query(migration);
    await limiter.assertReady();

    const results = await Promise.all(Array.from({ length: 12 }, () => limiter.take("shared-client", rule)));
    assert.equal(results.filter((result) => result.allowed).length, 3);
    assert.equal(results.filter((result) => !result.allowed).length, 9);
    assert.equal(results.every((result) => result.retryAfterSeconds > 0), true);

    const stored = await pool.query<{ request_count: number }>(
      "SELECT request_count FROM zone4you_rate_limit_buckets WHERE bucket_key = $1",
      ["shared-client"],
    );
    assert.equal(stored.rows[0]?.request_count, rule.limit + 1);

    assert.equal((await limiter.take("second-client", rule)).allowed, true);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
