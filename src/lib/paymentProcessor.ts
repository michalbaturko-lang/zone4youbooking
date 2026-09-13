import type Stripe from "stripe";
import { getLuxartAdapter, isRealLuxartMode } from "./adapterProvider";
import { BookingApiError } from "./errors";
import { assertPaymentWriteDeploymentReady } from "./paymentWriteGate";
import {
  applyVerifiedStripeTopup,
  verifyPaidStripeTopupSession,
  type DurablePaymentLedger,
  type IdempotentCreditSink,
} from "./stripeTopup";

const topupEventTypes = new Set<Stripe.Event.Type>([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

export function createLuxartCreditSink(): IdempotentCreditSink {
  return {
    async apply(topup, eventId) {
      assertPaymentWriteDeploymentReady();
      if (!isRealLuxartMode()) {
        throw new BookingApiError(503, "PAYMENTS_DISABLED", "Živé dobití není v demo režimu dostupné.");
      }
      const payment = await getLuxartAdapter({ userId: topup.userId, locale: "cs" }).createTopup({
        amountKc: topup.amountKc,
        provider: "stripe",
        idempotencyKey: eventId,
        providerSessionId: topup.sessionId,
        providerPaymentIntentId: topup.paymentIntentId,
      });
      return { luxartReference: payment.id };
    },
  };
}

export async function processStripeTopupEvent(
  event: Stripe.Event,
  dependencies: {
    expectedLivemode: boolean;
    retrieveSession(sessionId: string): Promise<Stripe.Checkout.Session>;
    ledger: DurablePaymentLedger;
    creditSink: IdempotentCreditSink;
  },
) {
  if (!topupEventTypes.has(event.type)) return { status: "ignored" as const };

  const eventSession = event.data.object as Stripe.Checkout.Session;
  if (eventSession.object !== "checkout.session" || !eventSession.id) {
    throw new BookingApiError(400, "STRIPE_EVENT_INVALID", "Stripe událost neobsahuje Checkout Session.");
  }

  const session = await dependencies.retrieveSession(eventSession.id);
  if (session.id !== eventSession.id) {
    throw new BookingApiError(409, "STRIPE_SESSION_MISMATCH", "Stripe session nelze bezpečně ověřit.");
  }
  if (event.type === "checkout.session.completed" && session.payment_status !== "paid") {
    return { status: "pending" as const };
  }

  const topup = verifyPaidStripeTopupSession(session, dependencies.expectedLivemode);
  return applyVerifiedStripeTopup(event.id, topup, {
    ledger: dependencies.ledger,
    creditSink: dependencies.creditSink,
  });
}
