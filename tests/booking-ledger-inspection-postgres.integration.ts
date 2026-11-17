import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import { inspectBookingLedger } from "../scripts/inspect-booking-ledger";
const connectionString = process.env.BOOKING_TEST_DATABASE_URL;
if (!connectionString) throw new Error("BOOKING_TEST_DATABASE_URL is required.");

test("support inspection reports correlatable hashes without changing unresolved booking records", async () => {
  const schema = `z4y_inspection_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString, max: 1 });
  const pool = new Pool({ connectionString, max: 1, options: `-c search_path=${schema}` });
  const user = "private-client-marker";
  const key = "private-idempotency-marker";
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await pool.query(await readFile("migrations/002_booking_mutation_ledger.sql", "utf8"));
    await pool.query(`INSERT INTO zone4you_booking_mutations
      (user_id, idempotency_key, operation, target_id, request_fingerprint, status)
      VALUES ($1, $2, 'create_reservation', 'private-target-marker', $3, 'uncertain')`, [user, key, "a".repeat(64)]);
    const before = await pool.query("SELECT * FROM zone4you_booking_mutations");
    const report = await inspectBookingLedger(pool);
    const after = await pool.query("SELECT * FROM zone4you_booking_mutations");
    assert.deepEqual(after.rows, before.rows);
    assert.equal(report.readOnly, true);
    assert.equal(report.truncated, false);
    assert.equal(report.counts.uncertain, 1);
    assert.equal(report.unresolved[0]?.userIdSha256, createHash("sha256").update(user).digest("hex"));
    assert.equal(report.unresolved[0]?.idempotencyKeySha256, createHash("sha256").update(key).digest("hex"));
    assert.equal(report.unresolved[0]?.mutationFingerprint, "a".repeat(64));
    assert.equal(JSON.stringify(report).includes("private-"), false);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
