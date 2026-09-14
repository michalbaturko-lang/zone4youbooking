import assert from "node:assert/strict";
import test from "node:test";
import {
  isBoundedKcAmount,
  maximumOperationalAmountKc,
} from "../src/lib/moneyBounds";

test("operational CZK values accept ordinary signed decimals and reject unsafe magnitudes", () => {
  assert.equal(isBoundedKcAmount(-maximumOperationalAmountKc), true);
  assert.equal(isBoundedKcAmount(149.5), true);
  assert.equal(isBoundedKcAmount(maximumOperationalAmountKc), true);
  assert.equal(isBoundedKcAmount(-1, 0), false);
  assert.equal(isBoundedKcAmount(maximumOperationalAmountKc + 0.01), false);
  assert.equal(isBoundedKcAmount(Number.POSITIVE_INFINITY), false);
  assert.equal(isBoundedKcAmount("200"), false);
});
