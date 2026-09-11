import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";
import { PostgresPaymentLedger } from "../src/lib/paymentLedger";
import type { VerifiedStripeTopup } from "../src/lib/stripeTopup";

const connectionString = process.env.PAYMENT_TEST_DATABASE_URL;
if (!connectionString) throw new Error("PAYMENT_TEST_DATABASE_URL is required for the PostgreSQL ledger integration test.");

test("PostgreSQL ledger atomically deduplicates event and Checkout Session", async () => {
  const schema = `z4y_payment_test_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString, max: 1 });
  const pool = new Pool({ connectionString, max: 4, options: `-c search_path=${schema}` });
  const migration = await readFile(join(process.cwd(), "migrations/001_payment_ledger.sql"), "utf8");
  const topup: VerifiedStripeTopup = {
    sessionId: "cs_test_ledger_1",
    paymentIntentId: "pi_ledger_1",
    userId: "42",
    amountKc: 500,
    amountMinor: 50_000,
    currency: "czk",
    livemode: false,
  };

  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await pool.query(migration);
    const ledger = new PostgresPaymentLedger(pool);
    await ledger.assertReady();

    assert.equal(await ledger.claim("evt_ledger_1", topup), "claimed");
    assert.equal(await ledger.claim("evt_ledger_1", topup), "in_progress");
    await ledger.markApplied("evt_ledger_1", "luxart-payment:901");
    assert.equal(await ledger.claim("evt_ledger_2", topup), "already_applied");

    await assert.rejects(
      ledger.claim("evt_ledger_1", { ...topup, sessionId: "cs_test_conflict", paymentIntentId: "pi_conflict" }),
      /koliduje/,
    );

    const second = { ...topup, sessionId: "cs_test_ledger_2", paymentIntentId: "pi_ledger_2" };
    const concurrent = await Promise.all([
      ledger.claim("evt_ledger_3", second),
      ledger.claim("evt_ledger_4", second),
    ]);
    assert.deepEqual([...concurrent].sort(), ["claimed", "in_progress"]);
    await ledger.markUncertain("evt_ledger_3", "CREDIT_SINK_FAILED");
    assert.equal(await ledger.claim("evt_ledger_4", second), "uncertain");
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
