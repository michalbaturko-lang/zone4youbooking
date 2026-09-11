import type Stripe from "stripe";
import { bookingRules } from "./bookingRules";
import type { User } from "./domain";
import { BookingApiError } from "./errors";
import type { Locale } from "./i18n";

export interface VerifiedStripeTopup {
  sessionId: string;
  paymentIntentId: string;
  userId: string;
  amountKc: number;
  amountMinor: number;
  currency: "czk";
  livemode: boolean;
}

function allowedTopupAmount(amountKc: number) {
  return Number.isSafeInteger(amountKc) && bookingRules.topupAmounts.includes(amountKc);
}

function approvedApplicationOrigin(baseUrl: string) {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new BookingApiError(503, "PAYMENT_CONFIG_INVALID", "Platební návratová URL není bezpečně nastavena.");
  }
  return url.origin;
}

export function approvedStripeCheckoutUrl(value: string | null | undefined) {
  if (!value) {
    throw new BookingApiError(502, "STRIPE_CHECKOUT_INVALID", "Stripe nevrátil bezpečný odkaz k platbě.");
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.username || url.password) {
      throw new Error("Unapproved Stripe Checkout URL.");
    }
    return url.toString();
  } catch {
    throw new BookingApiError(502, "STRIPE_CHECKOUT_INVALID", "Stripe nevrátil bezpečný odkaz k platbě.");
  }
}

export function buildStripeTopupCheckoutParams(input: {
  user: Pick<User, "id">;
  amountKc: number;
  locale: Locale;
  baseUrl: string;
}): Stripe.Checkout.SessionCreateParams {
  if (!allowedTopupAmount(input.amountKc)) {
    throw new BookingApiError(400, "TOPUP_AMOUNT_NOT_ALLOWED", "Vyberte jednu z povolených částek dobití.");
  }

  const origin = approvedApplicationOrigin(input.baseUrl);
  const metadata = {
    zone4you_user_id: input.user.id,
    amount_kc: String(input.amountKc),
  };

  return {
    mode: "payment",
    locale: input.locale,
    client_reference_id: input.user.id,
    success_url: `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?payment=cancelled`,
    metadata,
    payment_intent_data: { metadata },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "czk",
          unit_amount: input.amountKc * 100,
          product_data: {
            name: input.locale === "en" ? "Zone4You credit" : "Kredit Zone4You",
          },
        },
      },
    ],
  };
}

export function verifyPaidStripeTopupSession(
  session: Stripe.Checkout.Session,
  expectedLivemode: boolean,
): VerifiedStripeTopup {
  const amountKc = Number(session.metadata?.amount_kc);
  const userId = session.metadata?.zone4you_user_id;
  const amountMinor = session.amount_total;
  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;

  if (
    session.mode !== "payment" ||
    session.status !== "complete" ||
    session.payment_status !== "paid" ||
    session.livemode !== expectedLivemode ||
    session.currency !== "czk" ||
    typeof amountMinor !== "number" ||
    !Number.isSafeInteger(amountMinor) ||
    !allowedTopupAmount(amountKc) ||
    amountMinor !== amountKc * 100 ||
    !userId ||
    session.client_reference_id !== userId ||
    !paymentIntentId
  ) {
    throw new BookingApiError(409, "STRIPE_TOPUP_MISMATCH", "Platbu nelze bezpečně spárovat s kreditem.");
  }

  return {
    sessionId: session.id,
    paymentIntentId,
    userId,
    amountKc,
    amountMinor,
    currency: "czk",
    livemode: session.livemode,
  };
}

export type PaymentClaimResult = "claimed" | "already_applied" | "in_progress" | "uncertain";

export interface DurablePaymentLedger {
  claim(eventId: string, topup: VerifiedStripeTopup): Promise<PaymentClaimResult>;
  markApplied(eventId: string, luxartReference: string): Promise<void>;
  markUncertain(eventId: string, reasonCode: string): Promise<void>;
}

export interface IdempotentCreditSink {
  /** The sink must deduplicate by topup.sessionId, including after timeouts and retries. */
  apply(topup: VerifiedStripeTopup, eventId: string): Promise<{ luxartReference: string }>;
}

export async function applyVerifiedStripeTopup(
  eventId: string,
  topup: VerifiedStripeTopup,
  dependencies: { ledger: DurablePaymentLedger; creditSink: IdempotentCreditSink },
) {
  const claim = await dependencies.ledger.claim(eventId, topup);
  if (claim === "already_applied") return { status: "duplicate" as const };
  if (claim !== "claimed") {
    throw new BookingApiError(
      409,
      claim === "uncertain" ? "PAYMENT_RECONCILIATION_REQUIRED" : "PAYMENT_ALREADY_PROCESSING",
      "Platba čeká na bezpečné zpracování nebo ruční kontrolu.",
    );
  }

  try {
    const result = await dependencies.creditSink.apply(topup, eventId);
    await dependencies.ledger.markApplied(eventId, result.luxartReference);
    return { status: "applied" as const, luxartReference: result.luxartReference };
  } catch (error) {
    await dependencies.ledger.markUncertain(eventId, "CREDIT_SINK_FAILED");
    throw error;
  }
}
