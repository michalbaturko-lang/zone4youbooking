import assert from "node:assert/strict";
import test from "node:test";
import { bookingMutationsEnabled, isTrustedMutationOrigin, readIdempotencyKey } from "../src/lib/requestSecurity";

test("accepts only the configured application origin", () => {
  const trusted = new Request("https://booking.zone4you.cz/api/reservations", {
    method: "POST",
    headers: { Origin: "https://booking.zone4you.cz" },
  });
  const foreign = new Request("https://booking.zone4you.cz/api/reservations", {
    method: "POST",
    headers: { Origin: "https://example.invalid" },
  });

  assert.equal(isTrustedMutationOrigin(trusted, "https://booking.zone4you.cz"), true);
  assert.equal(isTrustedMutationOrigin(foreign, "https://booking.zone4you.cz"), false);
  assert.equal(
    isTrustedMutationOrigin(new Request("https://booking.zone4you.cz/api/reservations"), "https://booking.zone4you.cz"),
    false,
  );
});

test("live booking mutations fail closed unless the release switch is explicit", () => {
  assert.equal(bookingMutationsEnabled("demo"), true);
  assert.equal(bookingMutationsEnabled("live"), false);
  assert.equal(bookingMutationsEnabled("live", "false"), false);
  assert.equal(bookingMutationsEnabled("live", "true"), true);
});

test("booking writes require a bounded idempotency key", () => {
  assert.equal(
    readIdempotencyKey(new Request("https://booking.zone4you.cz/api/reservations", {
      headers: { "Idempotency-Key": "reserve:123e4567-e89b-12d3-a456-426614174000" },
    })),
    "reserve:123e4567-e89b-12d3-a456-426614174000",
  );
  assert.throws(
    () => readIdempotencyKey(new Request("https://booking.zone4you.cz/api/reservations")),
    /identifikátor/i,
  );
  assert.throws(
    () => readIdempotencyKey(new Request("https://booking.zone4you.cz/api/reservations", {
      headers: { "Idempotency-Key": "contains spaces" },
    })),
    /identifikátor/i,
  );
});
