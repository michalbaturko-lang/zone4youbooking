import { fail, ok } from "@/lib/apiResponse";
import { BookingApiError } from "@/lib/errors";
import { getPostgresPaymentLedger } from "@/lib/paymentLedger";
import { createLuxartCreditSink, processStripeTopupEvent } from "@/lib/paymentProcessor";
import {
  stripeExpectedLivemode,
  stripeWebhookSecret,
} from "@/lib/paymentConfig";
import { assertPaymentWriteDeploymentReady } from "@/lib/paymentWriteGate";
import { createStripeClient } from "@/lib/stripeClient";
import type Stripe from "stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const maximumWebhookBytes = 1024 * 1024;

interface StripeWebhookRouteDependencies {
  assertRuntimeReady(): void;
  constructEvent(rawBody: string, signature: string): Stripe.Event;
  processEvent(event: Stripe.Event): Promise<{ status: string }>;
}

function defaultDependencies(): StripeWebhookRouteDependencies {
  return {
    assertRuntimeReady: assertPaymentWriteDeploymentReady,
    constructEvent(rawBody, signature) {
      return createStripeClient().webhooks.constructEvent(rawBody, signature, stripeWebhookSecret());
    },
    async processEvent(event) {
      const stripe = createStripeClient();
      return processStripeTopupEvent(event, {
        expectedLivemode: stripeExpectedLivemode(),
        retrieveSession: (sessionId) => stripe.checkout.sessions.retrieve(sessionId),
        ledger: getPostgresPaymentLedger(),
        creditSink: createLuxartCreditSink(),
      });
    },
  };
}

export async function handleStripeWebhook(
  request: Request,
  dependencies: StripeWebhookRouteDependencies,
) {
  try {
    dependencies.assertRuntimeReady();
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      throw new BookingApiError(400, "STRIPE_SIGNATURE_MISSING", "Stripe podpis chybí.");
    }
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > maximumWebhookBytes) {
      throw new BookingApiError(413, "STRIPE_WEBHOOK_TOO_LARGE", "Stripe událost je příliš velká.");
    }
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > maximumWebhookBytes) {
      throw new BookingApiError(413, "STRIPE_WEBHOOK_TOO_LARGE", "Stripe událost je příliš velká.");
    }

    let event: Stripe.Event;
    try {
      event = dependencies.constructEvent(rawBody, signature);
    } catch {
      throw new BookingApiError(400, "STRIPE_SIGNATURE_INVALID", "Stripe podpis není platný.");
    }

    const result = await dependencies.processEvent(event);
    return ok({ received: true, result: result.status });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  return handleStripeWebhook(request, defaultDependencies());
}
