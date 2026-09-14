import assert from "node:assert/strict";
import test from "node:test";
import type {
  BookingMutationIdentity,
  BookingMutationLease,
  DurableBookingMutationLedger,
  StoredBookingMutationError,
} from "../src/lib/bookingMutationLedger";
import { processBookingMutation } from "../src/lib/bookingMutationProcessor";
import type { Reservation } from "../src/lib/domain";
import { BookingApiError, BookingMutationOutcomeUnknownError } from "../src/lib/errors";
import { maximumOperationalAmountKc } from "../src/lib/moneyBounds";

const reservation: Reservation = {
  id: "987",
  userId: "42",
  lessonId: "luxart:1:12:321:2026-09-01T14:30:00.000Z",
  status: "active",
  reservedAt: "2026-08-29T12:00:00.000Z",
  priceKc: 180,
  luxartCategoryId: 12,
};

function fakeLease(
  claim: BookingMutationLease<Reservation>["claim"],
  options: { response?: Reservation; error?: StoredBookingMutationError } = {},
) {
  const calls: string[] = [];
  const lease: BookingMutationLease<Reservation> = {
    claim,
    response: options.response,
    error: options.error,
    async markApplied() { calls.push("applied"); },
    async markRejected() { calls.push("rejected"); },
    async markUncertain() { calls.push("uncertain"); },
    async discard() { calls.push("discarded"); },
    async release() { calls.push("released"); },
  };
  return { lease, calls };
}

function ledgerWith(lease: BookingMutationLease<Reservation>): DurableBookingMutationLedger {
  return {
    async assertReady() {},
    async acquire<T>(_identity: BookingMutationIdentity) {
      return lease as BookingMutationLease<T>;
    },
  };
}

const baseInput = {
  userId: "42",
  idempotencyKey: "reserve:test:1",
  operation: "create_reservation" as const,
  targetId: reservation.lessonId,
};

test("an applied idempotency replay returns the stored reservation without another Luxart write", async () => {
  const { lease, calls } = fakeLease("applied", { response: reservation });
  let mutations = 0;
  const result = await processBookingMutation({
    ...baseInput,
    ledger: ledgerWith(lease),
    async mutate() { mutations += 1; return reservation; },
  });
  assert.equal(result.replayed, true);
  assert.equal(result.reservation.id, "987");
  assert.equal(mutations, 0);
  assert.deepEqual(calls, ["released"]);
});

test("a claimed mutation is recorded before returning success", async () => {
  const { lease, calls } = fakeLease("claimed");
  const result = await processBookingMutation({ ...baseInput, ledger: ledgerWith(lease), async mutate() { return reservation; } });
  assert.equal(result.replayed, false);
  assert.deepEqual(calls, ["applied", "released"]);
});

test("a claimed mutation rejects unsafe or inconsistent Luxart results as uncertain", async () => {
  const invalidResults: Reservation[] = [
    { ...reservation, userId: "43" },
    { ...reservation, lessonId: "luxart:1:13:321:2026-09-01T14:30:00.000Z" },
    { ...reservation, reservedAt: "2026-08-29T12:00:00" },
    { ...reservation, priceKc: -1 },
    { ...reservation, priceKc: maximumOperationalAmountKc + 1 },
    { ...reservation, luxartCategoryId: 13 },
    { ...reservation, luxartUuid: "unsafe\nidentifier" },
  ];

  for (const invalidResult of invalidResults) {
    const { lease, calls } = fakeLease("claimed");
    await assert.rejects(
      processBookingMutation({
        ...baseInput,
        ledger: ledgerWith(lease),
        async mutate() { return invalidResult; },
      }),
      (error: unknown) => error instanceof BookingApiError && error.code === "BOOKING_RECONCILIATION_REQUIRED",
    );
    assert.deepEqual(calls, ["uncertain", "released"]);
  }
});

test("an applied replay with an invalid financial result is rejected without another Luxart write", async () => {
  const { lease, calls } = fakeLease("applied", { response: { ...reservation, priceKc: -1 } });
  let mutations = 0;
  await assert.rejects(
    processBookingMutation({
      ...baseInput,
      ledger: ledgerWith(lease),
      async mutate() { mutations += 1; return reservation; },
    }),
    (error: unknown) => error instanceof BookingApiError && error.code === "BOOKING_LEDGER_STATE_INVALID",
  );
  assert.equal(mutations, 0);
  assert.deepEqual(calls, ["released"]);
});

test("a cancellation result must bind the reservation and include explicit non-negative fee evidence", async () => {
  const cancelled: Reservation = {
    ...reservation,
    status: "cancelled",
    cancelledAt: "2026-08-30T12:00:00.000Z",
    cancellationFeeKc: 0,
  };
  const valid = fakeLease("claimed");
  const result = await processBookingMutation({
    ...baseInput,
    operation: "cancel_reservation",
    targetId: reservation.id,
    ledger: ledgerWith(valid.lease),
    async mutate() { return cancelled; },
  });
  assert.equal(result.reservation.cancellationFeeKc, 0);
  assert.deepEqual(valid.calls, ["applied", "released"]);

  for (const invalidResult of [
    { ...cancelled, cancelledAt: "2026-08-30T12:00:00" },
    { ...cancelled, cancellationFeeKc: -1 },
    { ...cancelled, cancellationFeeKc: maximumOperationalAmountKc + 1 },
    { ...cancelled, id: "other" },
  ]) {
    const invalid = fakeLease("claimed");
    await assert.rejects(
      processBookingMutation({
        ...baseInput,
        operation: "cancel_reservation",
        targetId: reservation.id,
        ledger: ledgerWith(invalid.lease),
        async mutate() { return invalidResult; },
      }),
      (error: unknown) => error instanceof BookingApiError && error.code === "BOOKING_RECONCILIATION_REQUIRED",
    );
    assert.deepEqual(invalid.calls, ["uncertain", "released"]);
  }
});

test("an unknown Luxart write outcome becomes uncertain and is never discarded for blind retry", async () => {
  const { lease, calls } = fakeLease("claimed");
  await assert.rejects(
    processBookingMutation({
      ...baseInput,
      ledger: ledgerWith(lease),
      async mutate() { throw new BookingMutationOutcomeUnknownError(); },
    }),
    (error: unknown) => error instanceof BookingApiError && error.code === "BOOKING_RECONCILIATION_REQUIRED",
  );
  assert.deepEqual(calls, ["uncertain", "released"]);
});

test("a determinate business rejection is replayable while a safe preflight outage is retryable", async () => {
  const rejected = fakeLease("claimed");
  await assert.rejects(
    processBookingMutation({
      ...baseInput,
      ledger: ledgerWith(rejected.lease),
      async mutate() { throw new BookingApiError(409, "ALREADY_RESERVED", "Already reserved"); },
    }),
  );
  assert.deepEqual(rejected.calls, ["rejected", "released"]);

  const outage = fakeLease("claimed");
  await assert.rejects(
    processBookingMutation({
      ...baseInput,
      ledger: ledgerWith(outage.lease),
      async mutate() { throw new BookingApiError(502, "LUXART_UNREACHABLE", "Unavailable"); },
    }),
  );
  assert.deepEqual(outage.calls, ["discarded", "released"]);
});
