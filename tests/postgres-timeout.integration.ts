import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimePostgresPool } from "../src/lib/postgresPool";
const connectionString = process.env.BOOKING_TEST_DATABASE_URL;
if (!connectionString) throw new Error("BOOKING_TEST_DATABASE_URL is required.");

test("runtime database queries are cancelled by PostgreSQL and the pool remains usable", async () => {
  const pool = createRuntimePostgresPool({ connectionString, max: 1 }, "booking");
  try {
    await assert.rejects(pool.query("SELECT pg_sleep(10)"), (error: unknown) =>
      typeof error === "object" && error !== null && "code" in error && error.code === "57014");
    assert.equal((await pool.query("SELECT 1 AS ok")).rows[0]?.ok, 1);
  } finally { await pool.end(); }
});
