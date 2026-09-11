import Stripe from "stripe";
import { stripeSecretKey } from "./paymentConfig";

export function createStripeClient() {
  return new Stripe(stripeSecretKey(), {
    appInfo: { name: "Zone4You Booking", version: "0.2.0" },
    maxNetworkRetries: 2,
    timeout: 8_000,
  });
}
