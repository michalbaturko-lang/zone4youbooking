import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../src/app/api/payments/checkout/route";

test("live Checkout endpoint fails before session, database or Stripe when payments are disabled", async () => {
  const previous = {
    luxartMock: process.env.LUXART_MOCK,
    appBaseUrl: process.env.APP_BASE_URL,
    bookingMutations: process.env.BOOKING_MUTATIONS_ENABLED,
    paymentMutations: process.env.PAYMENT_MUTATIONS_ENABLED,
  };
  try {
    process.env.LUXART_MOCK = "false";
    process.env.APP_BASE_URL = "https://booking.zone4you.cz/";
    process.env.BOOKING_MUTATIONS_ENABLED = "true";
    process.env.PAYMENT_MUTATIONS_ENABLED = "false";
    const response = await POST(new Request("https://booking.zone4you.cz/api/payments/checkout", {
      method: "POST",
      headers: { origin: "https://booking.zone4you.cz", "content-type": "application/json" },
      body: JSON.stringify({ amountKc: 500 }),
    }));
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, "PAYMENTS_DISABLED");
  } finally {
    if (previous.luxartMock === undefined) delete process.env.LUXART_MOCK;
    else process.env.LUXART_MOCK = previous.luxartMock;
    if (previous.appBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previous.appBaseUrl;
    if (previous.bookingMutations === undefined) delete process.env.BOOKING_MUTATIONS_ENABLED;
    else process.env.BOOKING_MUTATIONS_ENABLED = previous.bookingMutations;
    if (previous.paymentMutations === undefined) delete process.env.PAYMENT_MUTATIONS_ENABLED;
    else process.env.PAYMENT_MUTATIONS_ENABLED = previous.paymentMutations;
  }
});
