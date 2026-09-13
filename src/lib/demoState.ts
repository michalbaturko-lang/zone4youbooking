import type { MockLuxartState } from "./mockLuxart";

export const maximumStoredDemoStateBytes = 60 * 1024;
const maximumDemoCollectionItems = 512;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

function optionalBoundedText(value: unknown, maximumLength: number) {
  return value === undefined || boundedText(value, maximumLength);
}

function finiteAmount(value: unknown, minimum = Number.NEGATIVE_INFINITY) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum;
}

function validDateTime(value: unknown) {
  return boundedText(value, 64) && Number.isFinite(Date.parse(value));
}

function validUser(value: unknown) {
  if (!record(value)) return false;
  return boundedText(value.id, 128) &&
    boundedText(value.login, 254) &&
    boundedText(value.fullName, 200) &&
    boundedText(value.email, 254) &&
    optionalBoundedText(value.phone, 64) &&
    optionalBoundedText(value.memberCardNumber, 128) &&
    optionalBoundedText(value.membership, 256) &&
    finiteAmount(value.creditBalanceKc);
}

function validReservation(value: unknown) {
  if (!record(value)) return false;
  return boundedText(value.id, 320) &&
    boundedText(value.userId, 128) &&
    boundedText(value.lessonId, 512) &&
    ["active", "cancelled", "attended", "no_show"].includes(String(value.status)) &&
    validDateTime(value.reservedAt) &&
    (value.cancelledAt === undefined || validDateTime(value.cancelledAt)) &&
    finiteAmount(value.priceKc, 0) &&
    (value.holdAmountKc === undefined || finiteAmount(value.holdAmountKc, 0)) &&
    (value.cancellationFeeKc === undefined || finiteAmount(value.cancellationFeeKc, 0));
}

function validWaitlistEntry(value: unknown) {
  if (!record(value)) return false;
  return boundedText(value.id, 320) &&
    boundedText(value.userId, 128) &&
    boundedText(value.lessonId, 512) &&
    ["waiting", "promoted", "left", "expired"].includes(String(value.status)) &&
    typeof value.position === "number" &&
    Number.isSafeInteger(value.position) &&
    value.position >= 0 &&
    (value.joinedAt === undefined || validDateTime(value.joinedAt)) &&
    (value.promotedAt === undefined || validDateTime(value.promotedAt));
}

function validCreditTransaction(value: unknown) {
  if (!record(value)) return false;
  return boundedText(value.id, 320) &&
    boundedText(value.userId, 128) &&
    [
      "reservation_charge",
      "reservation_refund",
      "late_cancel_fee",
      "no_show_fee",
      "topup",
      "waitlist_charge",
    ].includes(String(value.type)) &&
    finiteAmount(value.amountKc) &&
    finiteAmount(value.balanceAfterKc) &&
    validDateTime(value.occurredAt) &&
    optionalBoundedText(value.note, 1_000);
}

function validOccupiedCounts(value: unknown) {
  if (!record(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= maximumDemoCollectionItems && entries.every(([lessonId, occupiedCount]) =>
    boundedText(lessonId, 512) &&
    typeof occupiedCount === "number" &&
    Number.isSafeInteger(occupiedCount) &&
    occupiedCount >= 0 &&
    occupiedCount <= 100_000
  );
}

export function isSafeMockLuxartState(value: unknown): value is MockLuxartState {
  if (!record(value) || typeof value.loggedIn !== "boolean" || !validUser(value.userState)) return false;
  const reservations = value.reservations;
  const waitlist = value.waitlist;
  const transactions = value.transactions;
  return Array.isArray(reservations) &&
    reservations.length <= maximumDemoCollectionItems &&
    reservations.every(validReservation) &&
    Array.isArray(waitlist) &&
    waitlist.length <= maximumDemoCollectionItems &&
    waitlist.every(validWaitlistEntry) &&
    Array.isArray(transactions) &&
    transactions.length <= maximumDemoCollectionItems &&
    transactions.every(validCreditTransaction) &&
    validOccupiedCounts(value.occupiedCounts);
}

export function safeSerializedDemoState(value: unknown) {
  if (!isSafeMockLuxartState(value)) return undefined;
  try {
    const serialized = JSON.stringify(value);
    return new TextEncoder().encode(serialized).byteLength <= maximumStoredDemoStateBytes
      ? serialized
      : undefined;
  } catch {
    return undefined;
  }
}
