import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
import { handleStripeWebhook, POST } from "../src/app/api/payments/webhook/route";

test("webhook handler verifies the untouched raw body before ignoring unrelated events", async () => {
  const webhookSecret = "whsec_route_test";
  const payload = JSON.stringify({
    id: "evt_route_test",
    object: "event",
    type: "customer.created",
    livemode: false,
    data: { object: { id: "cus_route_test", object: "customer" } },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

  const dependencies = {
    assertRuntimeReady() {},
    constructEvent(rawBody: string, rawSignature: string) {
      return Stripe.webhooks.constructEvent(rawBody, rawSignature, webhookSecret);
    },
    async processEvent(event: Stripe.Event) {
      assert.equal(event.type, "customer.created");
      return { status: "ignored" };
    },
  };

  const response = await handleStripeWebhook(new Request("https://booking.zone4you.cz/api/payments/webhook", {
      method: "POST",
      headers: { "stripe-signature": signature, "content-type": "application/json" },
      body: payload,
    }), dependencies);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, result: "ignored" });

  const tampered = await handleStripeWebhook(new Request("https://booking.zone4you.cz/api/payments/webhook", {
      method: "POST",
      headers: { "stripe-signature": signature, "content-type": "application/json" },
      body: `${payload} `,
    }), dependencies);
  assert.equal(tampered.status, 400);
  assert.equal((await tampered.json()).code, "STRIPE_SIGNATURE_INVALID");
});

test("production webhook route stays disabled while the checked-in business rules are provisional", async () => {
  const response = await POST(new Request("https://booking.zone4you.cz/api/payments/webhook", {
    method: "POST",
    headers: { "stripe-signature": "not-used" },
    body: "{}",
  }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "PAYMENTS_DISABLED");
});
