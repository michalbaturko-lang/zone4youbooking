import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { PostgresBookingMutationLedger } from "../src/lib/bookingMutationLedger";
import { BookingApiError } from "../src/lib/errors";
import { PostgresFixedWindowRateLimiter } from "../src/lib/rateLimit";

function poolReturning(...rows: Array<Record<string, unknown>>) {
  let call = 0;
  return {
    async query() {
      const row = rows[call];
      call += 1;
      return { rows: row ? [row] : [] };
    },
  } as unknown as Pool;
}

test("booking ledger readiness requires the exact migration version and key constraints", async () => {
  const tables = {
    table_name: "zone4you_booking_mutations",
    schema_table_name: "zone4you_booking_mutation_schema",
  };
  const exactSchema = {
    version: 1,
    version_rows: 1,
    primary_key_valid: true,
    idempotency_unique_valid: true,
  };
  await new PostgresBookingMutationLedger(poolReturning(tables, exactSchema)).assertReady();

  for (const invalid of [
    { ...exactSchema, version_rows: 2 },
    { ...exactSchema, primary_key_valid: false },
    { ...exactSchema, idempotency_unique_valid: false },
  ]) {
    await assert.rejects(
      new PostgresBookingMutationLedger(poolReturning(tables, invalid)).assertReady(),
      (error: unknown) => error instanceof BookingApiError && error.code === "BOOKING_LEDGER_NOT_READY",
    );
  }
});

test("shared rate-limit readiness requires the exact bucket primary key", async () => {
  const tables = {
    table_name: "zone4you_rate_limit_buckets",
    schema_table_name: "zone4you_rate_limit_schema",
  };
  const exactSchema = {
    version: 1,
    version_rows: 1,
    bucket_primary_key_valid: true,
  };
  await new PostgresFixedWindowRateLimiter(poolReturning(tables, exactSchema)).assertReady();

  for (const invalid of [
    { ...exactSchema, version: 2 },
    { ...exactSchema, version_rows: 2 },
    { ...exactSchema, bucket_primary_key_valid: false },
  ]) {
    await assert.rejects(
      new PostgresFixedWindowRateLimiter(poolReturning(tables, invalid)).assertReady(),
      (error: unknown) => error instanceof BookingApiError && error.code === "RATE_LIMIT_NOT_READY",
    );
  }
});
