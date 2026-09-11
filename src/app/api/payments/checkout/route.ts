import { fail, ok } from "@/lib/apiResponse";
import { getRequestLuxartAdapter, isRealLuxartMode } from "@/lib/adapterProvider";
import { BookingApiError } from "@/lib/errors";
import { getPostgresPaymentLedger } from "@/lib/paymentLedger";
import { assertPaymentRuntimeReady } from "@/lib/paymentConfig";
import { assertRateLimit, rateLimitRules } from "@/lib/rateLimit";
import { assertTrustedMutation } from "@/lib/requestSecurity";
import { readBookingSession } from "@/lib/session";
import { createStripeClient } from "@/lib/stripeClient";
import { approvedStripeCheckoutUrl, buildStripeTopupCheckoutParams } from "@/lib/stripeTopup";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    assertPaymentRuntimeReady();
    if (!isRealLuxartMode()) {
      throw new BookingApiError(503, "PAYMENTS_DISABLED", "Stripe Checkout není v demo režimu dostupný.");
    }

    const session = readBookingSession(request);
    if (!session) throw new BookingApiError(401, "AUTH_REQUIRED", "Pro dobití kreditu se přihlaste.");
    const body = (await request.json()) as { amountKc?: number };
    const amountKc = Number(body.amountKc);
    await assertRateLimit(request, rateLimitRules.topup, session.userId);

    const user = await getRequestLuxartAdapter(request).getCurrentUser();
    if (!user || user.id !== session.userId) {
      throw new BookingApiError(401, "AUTH_REQUIRED", "Přihlášení už není platné.");
    }

    const ledger = getPostgresPaymentLedger();
    await ledger.assertReady();
    const params = buildStripeTopupCheckoutParams({
      user,
      amountKc,
      locale: request.headers.get("x-zone4you-locale") === "en" ? "en" : "cs",
      baseUrl: process.env.APP_BASE_URL!,
    });
    const checkout = await createStripeClient().checkout.sessions.create(params, {
      idempotencyKey: `z4y_checkout_${randomUUID()}`,
    });
    return ok(
      { checkoutSessionId: checkout.id, url: approvedStripeCheckoutUrl(checkout.url) },
      { status: 201 },
    );
  } catch (error) {
    return fail(error);
  }
}
