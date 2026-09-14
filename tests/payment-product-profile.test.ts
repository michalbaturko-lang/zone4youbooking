import assert from "node:assert/strict";
import test from "node:test";
import {
  paymentProductProfile,
  paymentProductProfileMatchesImplementation,
  paymentProductProfileSha256,
  paymentProductRuntimeReady,
} from "../src/lib/paymentProductProfile";

test("confirmed payment product profile exactly matches the five approved CZK top-up amounts", () => {
  assert.equal(paymentProductProfile.status, "confirmed");
  assert.equal(paymentProductProfile.currency, "CZK");
  assert.deepEqual(paymentProductProfile.allowedTopupAmountsKc, [500, 1000, 2000, 5000, 10000]);
  assert.equal(paymentProductProfileMatchesImplementation(), true);
});

test("payment product activation requires the exact profile digest and rejects amount drift", () => {
  const environment = {
    PAYMENT_PRODUCT_CONFIRMED: "true",
    PAYMENT_PRODUCT_PROFILE_SHA256: paymentProductProfileSha256(),
  };
  assert.equal(paymentProductRuntimeReady(environment), true);
  assert.equal(paymentProductRuntimeReady({ ...environment, PAYMENT_PRODUCT_PROFILE_SHA256: "stale" }), false);
  assert.equal(
    paymentProductProfileMatchesImplementation({
      ...paymentProductProfile,
      allowedTopupAmountsKc: [500, 1000, 2000, 5000],
    }),
    false,
  );
});
