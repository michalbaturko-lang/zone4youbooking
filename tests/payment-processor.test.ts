import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import { processStripeTopupEvent } from "../src/lib/paymentProcessor";
import type { DurablePaymentLedger, VerifiedStripeTopup } from "../src/lib/stripeTopup";

function checkoutSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: "cs_test_processor",
    object: "checkout.session",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    currency: "czk",
    amount_total: 50_000,
    client_reference_id: "42",
    metadata: { zone4you_user_id: "42", amount_kc: "500" },
    payment_intent: "pi_processor",
    livemode: false,
    ...overrides,
  } as Stripe.Checkout.Session;
}

function stripeEvent(type: Stripe.Event.Type, session = checkoutSession()): Stripe.Event {
  return {
    id: "evt_processor",
    object: "event",
    type,
    data: { object: session },
    livemode: false,
  } as Stripe.Event;
}

test("ignores unrelated Stripe events without touching payment dependencies", async () => {
  let retrieved = false;
  const result = await processStripeTopupEvent(stripeEvent("customer.created"), {
    expectedLivemode: false,
    async retrieveSession() { retrieved = true; return checkoutSession(); },
    ledger: {} as DurablePaymentLedger,
    creditSink: { async apply() { throw new Error("not expected"); } },
  });
  assert.deepEqual(result, { status: "ignored" });
  assert.equal(retrieved, false);
});

test("waits for an async success event instead of crediting an unpaid completed session", async () => {
  let claimed = false;
  const unpaid = checkoutSession({ payment_status: "unpaid" });
  const result = await processStripeTopupEvent(stripeEvent("checkout.session.completed", unpaid), {
    expectedLivemode: false,
    async retrieveSession() { return unpaid; },
    ledger: {
      async claim() { claimed = true; return "claimed"; },
      async markApplied() {},
      async markUncertain() {},
    },
    creditSink: { async apply() { throw new Error("not expected"); } },
  });
  assert.deepEqual(result, { status: "pending" });
  assert.equal(claimed, false);
});

test("passes a paid signed session through the ledger and Luxart sink once", async () => {
  const applied = new Set<string>();
  let sinkCalls = 0;
  const ledger: DurablePaymentLedger = {
    async claim(eventId: string, _topup: VerifiedStripeTopup) {
      return applied.has(eventId) ? "already_applied" : "claimed";
    },
    async markApplied(eventId: string) { applied.add(eventId); },
    async markUncertain() {},
  };
  const dependencies = {
    expectedLivemode: false,
    async retrieveSession() { return checkoutSession(); },
    ledger,
    creditSink: {
      async apply(_topup: VerifiedStripeTopup, eventId: string) {
        sinkCalls += 1;
        assert.equal(eventId, "evt_processor");
        return { luxartReference: "luxart-payment:901" };
      },
    },
  };

  assert.equal((await processStripeTopupEvent(stripeEvent("checkout.session.completed"), dependencies)).status, "applied");
  assert.equal((await processStripeTopupEvent(stripeEvent("checkout.session.completed"), dependencies)).status, "duplicate");
  assert.equal(sinkCalls, 1);
});
