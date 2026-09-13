import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";
import { PostgresBookingMutationLedger } from "../src/lib/bookingMutationLedger";
import { processBookingMutation } from "../src/lib/bookingMutationProcessor";
import type { Reservation } from "../src/lib/domain";
import { BookingApiError } from "../src/lib/errors";

const connectionString = process.env.BOOKING_TEST_DATABASE_URL;
if (!connectionString) throw new Error("BOOKING_TEST_DATABASE_URL is required for the PostgreSQL ledger integration test.");

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

test("PostgreSQL booking ledger serializes a user and replays one reservation result", async () => {
  const schema = `z4y_booking_test_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString, max: 1 });
  const pool = new Pool({ connectionString, max: 6, options: `-c search_path=${schema}` });
  const migration = await readFile(join(process.cwd(), "migrations/002_booking_mutation_ledger.sql"), "utf8");
  const reservation: Reservation = {
    id: "987",
    userId: "42",
    lessonId: "luxart:1:12:321:2026-09-01T14:30:00.000Z",
    status: "active",
    reservedAt: "2026-08-29T12:00:00.000Z",
    priceKc: 180,
    luxartCategoryId: 12,
  };

  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await pool.query(migration);
    const ledger = new PostgresBookingMutationLedger(pool);
    await ledger.assertReady();

    let continueMutation!: () => void;
    let mutationStarted!: () => void;
    const started = new Promise<void>((resolve) => { mutationStarted = resolve; });
    const continueAfterConcurrentRequest = new Promise<void>((resolve) => { continueMutation = resolve; });
    let luxartWrites = 0;
    const input = {
      ledger,
      userId: "42",
      idempotencyKey: "reserve:postgres:1",
      operation: "create_reservation" as const,
      targetId: reservation.lessonId,
    };
    const first = processBookingMutation({
      ...input,
      async mutate() {
        luxartWrites += 1;
        mutationStarted();
        await continueAfterConcurrentRequest;
        return reservation;
      },
    });
    await started;

    await assert.rejects(
      processBookingMutation({
        ...input,
        idempotencyKey: "reserve:postgres:concurrent",
        async mutate() { luxartWrites += 1; return reservation; },
      }),
      (error: unknown) => error instanceof BookingApiError && error.code === "BOOKING_ALREADY_PROCESSING",
    );
    continueMutation();
    assert.equal((await first).replayed, false);
    assert.equal(luxartWrites, 1);

    for (let repeat = 0; repeat < 3; repeat += 1) {
      const replay = await processBookingMutation({
        ...input,
        async mutate() { throw new Error("Luxart must not be called for a replay."); },
      });
      assert.equal(replay.replayed, true);
      assert.equal(replay.reservation.id, "987");
    }

    const differentBrowserKey = await processBookingMutation({
      ...input,
      idempotencyKey: "reserve:postgres:other-browser",
      async mutate() { throw new Error("A fresh browser key must replay the recent confirmed reservation."); },
    });
    assert.equal(differentBrowserKey.replayed, true);
    assert.equal(luxartWrites, 1);

    const cancelIdentity = {
      userId: "42",
      idempotencyKey: "cancel:postgres:applied",
      operation: "cancel_reservation" as const,
      targetId: "987",
      requestFingerprint: "cancel-applied-fingerprint",
    };
    const cancel = await ledger.acquire<Reservation>(cancelIdentity);
    assert.equal(cancel.claim, "claimed");
    const cancelledReservation: Reservation = {
      ...reservation,
      status: "cancelled",
      cancelledAt: "2026-08-29T12:05:00.000Z",
    };
    await cancel.markApplied(cancelledReservation);
    await cancel.release();
    const cancelReplay = await ledger.acquire<Reservation>({
      ...cancelIdentity,
      idempotencyKey: "cancel:postgres:other-browser",
      requestFingerprint: "cancel-replay-fingerprint",
    });
    assert.equal(cancelReplay.claim, "applied");
    assert.equal(cancelReplay.response?.status, "cancelled");
    await cancelReplay.release();

    const rebook = await ledger.acquire<Reservation>({
      ...input,
      idempotencyKey: "reserve:postgres:after-cancel",
      requestFingerprint: "reserve-after-cancel-fingerprint",
    });
    assert.equal(rebook.claim, "claimed");
    await rebook.discard();
    await rebook.release();

    const orphan = await ledger.acquire<Reservation>({
      userId: "42",
      idempotencyKey: "cancel:postgres:orphan",
      operation: "cancel_reservation",
      targetId: "999",
      requestFingerprint: "cancel-fingerprint",
    });
    assert.equal(orphan.claim, "claimed");
    await orphan.release();
    const blocked = await ledger.acquire<Reservation>({
      userId: "42",
      idempotencyKey: "cancel:postgres:retry",
      operation: "cancel_reservation",
      targetId: "999",
      requestFingerprint: "retry-fingerprint",
    });
    assert.equal(blocked.claim, "uncertain");
    await blocked.release();

    const uniqueConstraint = await pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = to_regclass('zone4you_booking_mutations')
         AND contype = 'u'
         AND pg_get_constraintdef(oid) = 'UNIQUE (user_id, idempotency_key)'`,
    );
    assert.equal(uniqueConstraint.rowCount, 1);
    await pool.query(
      `ALTER TABLE zone4you_booking_mutations DROP CONSTRAINT ${quoteIdentifier(uniqueConstraint.rows[0]!.conname)}`,
    );
    await pool.query(
      "ALTER TABLE zone4you_booking_mutations ADD CONSTRAINT zone4you_booking_mutations_decoy_key UNIQUE (idempotency_key)",
    );
    await assert.rejects(
      ledger.assertReady(),
      (error: unknown) => error instanceof BookingApiError && error.code === "BOOKING_LEDGER_NOT_READY",
    );
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
