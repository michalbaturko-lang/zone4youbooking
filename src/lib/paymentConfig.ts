import { BookingApiError } from "./errors";
import {
  businessRulesProfile,
  businessRulesRuntimeReady,
  type BusinessRulesEnvironment,
  type BusinessRulesProfile,
} from "./businessRuleConfirmation";
import { paymentProductRuntimeReady } from "./paymentProductProfile";

function configured(environment: BusinessRulesEnvironment, name: string) {
  return typeof environment[name] === "string" && environment[name]!.trim().length > 0;
}

function validHttpsOrigin(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.hostname.endsWith(".invalid") &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function validTlsPostgresUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname ||
      url.hostname.endsWith(".invalid")
    ) return false;
    const sslMode = url.searchParams.get("sslmode");
    return ["require", "verify-ca", "verify-full"].includes(sslMode ?? "");
  } catch {
    return false;
  }
}

export function paymentMutationsRequested(environment: BusinessRulesEnvironment = process.env) {
  return environment.PAYMENT_MUTATIONS_ENABLED === "true";
}

export function paymentConfigurationProblems(
  environment: BusinessRulesEnvironment = process.env,
  profile: BusinessRulesProfile = businessRulesProfile,
) {
  const problems: string[] = [];
  const livemode = environment.STRIPE_LIVEMODE;
  const secret = environment.STRIPE_SECRET_KEY ?? "";

  if (environment.LUXART_MOCK !== "false") problems.push("LUXART_LIVE_MODE");
  if (environment.BOOKING_MUTATIONS_ENABLED !== "true") problems.push("BOOKING_MUTATIONS_DISABLED");
  if (!businessRulesRuntimeReady(environment, profile)) problems.push("BOOKING_RULES_UNCONFIRMED");
  if (environment.BOOKING_LEDGER_MODE !== "postgres") problems.push("BOOKING_LEDGER_MODE");
  if (!validTlsPostgresUrl(environment.BOOKING_DATABASE_URL)) problems.push("BOOKING_DATABASE_URL");
  if (!paymentMutationsRequested(environment)) problems.push("PAYMENT_MUTATIONS_DISABLED");
  if (!validHttpsOrigin(environment.APP_BASE_URL)) problems.push("APP_BASE_URL");
  if (!configured(environment, "STRIPE_SECRET_KEY") || secret.length < 16) problems.push("STRIPE_SECRET_KEY");
  if (
    !configured(environment, "STRIPE_WEBHOOK_SECRET") ||
    !environment.STRIPE_WEBHOOK_SECRET!.startsWith("whsec_") ||
    environment.STRIPE_WEBHOOK_SECRET!.length < 16
  ) {
    problems.push("STRIPE_WEBHOOK_SECRET");
  }
  if (!["true", "false"].includes(livemode ?? "")) problems.push("STRIPE_LIVEMODE");
  if (livemode === "true" && !secret.startsWith("sk_live_")) problems.push("STRIPE_LIVE_KEY_MISMATCH");
  if (livemode === "false" && !secret.startsWith("sk_test_")) problems.push("STRIPE_TEST_KEY_MISMATCH");
  if (environment.PAYMENT_LEDGER_MODE !== "postgres") problems.push("PAYMENT_LEDGER_MODE");
  if (!validTlsPostgresUrl(environment.PAYMENT_DATABASE_URL)) problems.push("PAYMENT_DATABASE_URL");
  if (!paymentProductRuntimeReady(environment)) problems.push("PAYMENT_PRODUCT_PROFILE");
  if (environment.LUXART_PAYMENT_MAPPING_CONFIRMED !== "true") problems.push("LUXART_PAYMENT_MAPPING");

  const methodId = Number(environment.LUXART_STRIPE_PAYMENT_METHOD_ID);
  if (!Number.isInteger(methodId) || methodId <= 0) problems.push("LUXART_STRIPE_PAYMENT_METHOD_ID");
  return problems;
}

export function paymentRuntimeReady(
  environment: BusinessRulesEnvironment = process.env,
  profile: BusinessRulesProfile = businessRulesProfile,
) {
  return paymentConfigurationProblems(environment, profile).length === 0;
}

export function assertPaymentRuntimeReady() {
  if (paymentRuntimeReady()) return;
  throw new BookingApiError(
    503,
    "PAYMENTS_DISABLED",
    "Online dobití je do dokončení bezpečné platební konfigurace vypnuté.",
  );
}

export function stripeExpectedLivemode() {
  if (process.env.STRIPE_LIVEMODE === "true") return true;
  if (process.env.STRIPE_LIVEMODE === "false") return false;
  throw new BookingApiError(503, "PAYMENT_CONFIG_INVALID", "Stripe režim není jednoznačně nastaven.");
}

export function stripeSecretKey() {
  assertPaymentRuntimeReady();
  return process.env.STRIPE_SECRET_KEY!;
}

export function stripeWebhookSecret() {
  assertPaymentRuntimeReady();
  return process.env.STRIPE_WEBHOOK_SECRET!;
}

export function paymentDatabaseUrl() {
  assertPaymentRuntimeReady();
  return process.env.PAYMENT_DATABASE_URL!;
}
