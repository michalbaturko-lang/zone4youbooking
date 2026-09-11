import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import {
  applyVerifiedStripeTopup,
  approvedStripeCheckoutUrl,
  buildStripeTopupCheckoutParams,
  verifyPaidStripeTopupSession,
  type DurablePaymentLedger,
  type VerifiedStripeTopup,
} from "../src/lib/stripeTopup";

function paidSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: "cs_test_zone4you",
    object: "checkout.session",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    currency: "czk",
    amount_total: 50_000,
    client_reference_id: "user-1",
    metadata: { zone4you_user_id: "user-1", amount_kc: "500" },
    payment_intent: "pi_zone4you",
    livemode: false,
    ...overrides,
  } as Stripe.Checkout.Session;
}

test("builds a server-owned CZK Checkout Session for an allowed amount", () => {
  const params = buildStripeTopupCheckoutParams({
    user: { id: "user-1" },
    amountKc: 500,
    locale: "en",
    baseUrl: "https://booking.zone4you.cz/",
  });

  assert.equal(params.mode, "payment");
  assert.equal(params.client_reference_id, "user-1");
  assert.equal(params.line_items?.[0]?.price_data?.currency, "czk");
  assert.equal(params.line_items?.[0]?.price_data?.unit_amount, 50_000);
  assert.equal(params.metadata?.amount_kc, "500");
  assert.match(String(params.success_url), /\{CHECKOUT_SESSION_ID\}/);
});

test("rejects unapproved amounts and unsafe return URLs", () => {
  assert.throws(
    () => buildStripeTopupCheckoutParams({ user: { id: "user-1" }, amountKc: 501, locale: "cs", baseUrl: "https://booking.zone4you.cz/" }),
    /povolených částek/,
  );
  assert.throws(
    () => buildStripeTopupCheckoutParams({ user: { id: "user-1" }, amountKc: 500, locale: "cs", baseUrl: "http://booking.zone4you.cz/" }),
    /návratová URL/,
  );
  assert.equal(
    approvedStripeCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test_zone4you"),
    "https://checkout.stripe.com/c/pay/cs_test_zone4you",
  );
  assert.throws(() => approvedStripeCheckoutUrl("https://checkout.stripe.com.evil.example/pay"), /bezpečný odkaz/);
});

test("accepts only a paid, fully matched Checkout Session", () => {
  assert.deepEqual(verifyPaidStripeTopupSession(paidSession(), false), {
    sessionId: "cs_test_zone4you",
    paymentIntentId: "pi_zone4you",
    userId: "user-1",
    amountKc: 500,
    amountMinor: 50_000,
    currency: "czk",
    livemode: false,
  });

  assert.throws(() => verifyPaidStripeTopupSession(paidSession({ amount_total: 49_900 }), false), /spárovat/);
  assert.throws(() => verifyPaidStripeTopupSession(paidSession({ payment_status: "unpaid" }), false), /spárovat/);
  assert.throws(() => verifyPaidStripeTopupSession(paidSession({ client_reference_id: "user-2" }), false), /spárovat/);
  assert.throws(() => verifyPaidStripeTopupSession(paidSession(), true), /spárovat/);
});

test("credits once for a claimed event and short-circuits an applied duplicate", async () => {
  const topup = verifyPaidStripeTopupSession(paidSession(), false);
  let creditCalls = 0;
  const appliedEvents = new Set<string>();
  const ledger: DurablePaymentLedger = {
    async claim(eventId: string, _topup: VerifiedStripeTopup) {
      return appliedEvents.has(eventId) ? "already_applied" : "claimed";
    },
    async markApplied(eventId: string) {
      appliedEvents.add(eventId);
    },
    async markUncertain() {},
  };
  const creditSink = {
    async apply() {
      creditCalls += 1;
      return { luxartReference: "luxart-payment-1" };
    },
  };

  assert.equal((await applyVerifiedStripeTopup("evt_1", topup, { ledger, creditSink })).status, "applied");
  assert.equal((await applyVerifiedStripeTopup("evt_1", topup, { ledger, creditSink })).status, "duplicate");
  assert.equal(creditCalls, 1);
});

test("moves an ambiguous Luxart failure to manual reconciliation", async () => {
  const topup = verifyPaidStripeTopupSession(paidSession(), false);
  let uncertain = false;
  const ledger: DurablePaymentLedger = {
    async claim() { return "claimed"; },
    async markApplied() {},
    async markUncertain() { uncertain = true; },
  };

  await assert.rejects(
    applyVerifiedStripeTopup("evt_2", topup, {
      ledger,
      creditSink: { async apply() { throw new Error("Luxart timeout"); } },
    }),
    /Luxart timeout/,
  );
  assert.equal(uncertain, true);
});
