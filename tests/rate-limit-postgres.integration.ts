import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";
import { BookingApiError } from "../src/lib/errors";
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

    await pool.query(
      `INSERT INTO zone4you_rate_limit_buckets (bucket_key, scope, request_count, reset_at, updated_at)
       SELECT
         'expired-' || number::text,
         'cleanup-test',
         1,
         clock_timestamp() - interval '2 hours',
         clock_timestamp() - interval '2 hours'
       FROM generate_series(1, 150) AS number`,
    );
    await pool.query(
      `INSERT INTO zone4you_rate_limit_buckets (bucket_key, scope, request_count, reset_at, updated_at)
       VALUES
         ('active-cleanup-control', 'cleanup-test', 1, clock_timestamp() + interval '1 hour', clock_timestamp()),
         ('cleanup-trigger', 'cleanup-test', 2, clock_timestamp() - interval '2 hours', clock_timestamp() - interval '2 hours')`,
    );

    assert.equal((await limiter.take("cleanup-trigger", rule)).allowed, true);
    const cleanupState = await pool.query<{
      expired_count: number;
      active_count: number;
      trigger_count: number;
      trigger_is_active: boolean;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE bucket_key LIKE 'expired-%')::int AS expired_count,
         COUNT(*) FILTER (WHERE bucket_key = 'active-cleanup-control')::int AS active_count,
         MAX(request_count) FILTER (WHERE bucket_key = 'cleanup-trigger')::int AS trigger_count,
         BOOL_AND(reset_at > clock_timestamp()) FILTER (WHERE bucket_key = 'cleanup-trigger') AS trigger_is_active
       FROM zone4you_rate_limit_buckets`,
    );
    assert.equal(cleanupState.rows[0]?.expired_count, 50);
    assert.equal(cleanupState.rows[0]?.active_count, 1);
    assert.equal(cleanupState.rows[0]?.trigger_count, 1);
    assert.equal(cleanupState.rows[0]?.trigger_is_active, true);

    await pool.query("ALTER TABLE zone4you_rate_limit_buckets DROP CONSTRAINT zone4you_rate_limit_buckets_pkey");
    await pool.query(
      "ALTER TABLE zone4you_rate_limit_buckets ADD CONSTRAINT zone4you_rate_limit_buckets_decoy_pkey PRIMARY KEY (bucket_key, scope)",
    );
    await assert.rejects(
      limiter.assertReady(),
      (error: unknown) => error instanceof BookingApiError && error.code === "RATE_LIMIT_NOT_READY",
    );
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
