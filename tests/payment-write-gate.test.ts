import assert from "node:assert/strict";
import test from "node:test";
import {
  paymentWriteDeploymentProblems,
  paymentWriteDeploymentReady,
} from "../src/lib/paymentWriteGate";
import { paymentProductProfileSha256 } from "../src/lib/paymentProductProfile";
import {
  confirmedBusinessRulesEnvironment,
  confirmedBusinessRulesProfile,
} from "./testBusinessRules";

const commit = "1234567890abcdef1234567890abcdef12345678";

function stripeStagingEnvironment(overrides: Record<string, string | undefined> = {}) {
  return confirmedBusinessRulesEnvironment({
    ZONE4YOU_DEPLOYMENT_TARGET: "staging",
    ZONE4YOU_DEPLOYMENT_PHASE: "booking_with_stripe",
    ZONE4YOU_DEPLOYMENT_COMMIT: commit,
    ZONE4YOU_STAGING_APP_ORIGIN: "https://staging.booking.zone4you.cz/",
    NEXT_PUBLIC_APP_ENV: "staging",
    APP_BASE_URL: "https://staging.booking.zone4you.cz/",
    VERCEL_REGION: "fra1",
    LUXART_MOCK: "false",
    LUXART_API_CONTRACT: "memberzone_rest_v1",
    LUXART_API_BASE_URL: "https://luxart-test.example.com:9759/",
    LUXART_ALLOW_INSECURE_TEST_HTTP: "false",
    LUXART_RESORT_ID: "1",
    LUXART_TIMEOUT_MS: "12000",
    LUXART_API_AUTH_MODE: "none",
    LUXART_API_AUTH_CONFIRMED: "true",
    LUXART_LOGIN_QUERY_LOGGING_CONFIRMED: "true",
    RATE_LIMIT_MODE: "memory",
    RATE_LIMIT_SINGLE_INSTANCE: "true",
    SESSION_SECRET: "fake-session-secret-for-tests-2026-A9",
    NOTIFICATION_PROVIDER: "luxart",
    LUXART_NOTIFICATION_TEMPLATES_CONFIRMED: "true",
    LUXART_WAITLIST_ENABLED: "false",
    LUXART_WATCHDOG_VARIANT: "watchdog_III",
    LUXART_RESOURCE_MAP_JSON: JSON.stringify({ 1: 101, 2: 102, 3: 203 }),
    BOOKING_MUTATIONS_ENABLED: "true",
    BOOKING_LEDGER_MODE: "postgres",
    BOOKING_DATABASE_URL: "postgresql://booking.example.com/zone4you?sslmode=require",
    PAYMENT_MUTATIONS_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_test_zone4you_example",
    STRIPE_WEBHOOK_SECRET: "whsec_zone4you_example",
    STRIPE_LIVEMODE: "false",
    PAYMENT_LEDGER_MODE: "postgres",
    PAYMENT_DATABASE_URL: "postgresql://payments.example.com/zone4you?sslmode=require",
    PAYMENT_PRODUCT_CONFIRMED: "true",
    PAYMENT_PRODUCT_PROFILE_SHA256: paymentProductProfileSha256(),
    LUXART_PAYMENT_MAPPING_CONFIRMED: "true",
    LUXART_STRIPE_PAYMENT_METHOD_ID: "3",
    ...overrides,
  });
}

test("Stripe credit writes require the complete live deployment gate and payment phase", () => {
  const ready = stripeStagingEnvironment();
  assert.equal(paymentWriteDeploymentReady(ready, confirmedBusinessRulesProfile), true);
  assert.deepEqual(paymentWriteDeploymentProblems(ready, confirmedBusinessRulesProfile), []);

  for (const [name, environment, expectedProblem] of [
    ["region", { ...ready, VERCEL_REGION: "iad1" }, "PERSONALIZED_DEPLOYMENT_REGION"],
    ["phase", { ...ready, ZONE4YOU_DEPLOYMENT_PHASE: "booking_without_payments" }, "PAYMENT_DEPLOYMENT_PHASE"],
    ["query logging", { ...ready, LUXART_LOGIN_QUERY_LOGGING_CONFIRMED: "false" }, "LUXART_LOGIN_QUERY_LOGGING_UNCONFIRMED"],
    ["gateway", { ...ready, LUXART_API_AUTH_CONFIRMED: "false" }, "LUXART_GATEWAY_AUTH"],
    ["notifications", { ...ready, LUXART_NOTIFICATION_TEMPLATES_CONFIRMED: "false" }, "LUXART_NOTIFICATION_TEMPLATES_UNCONFIRMED"],
  ] as const) {
    const problems = paymentWriteDeploymentProblems(environment, confirmedBusinessRulesProfile);
    assert.equal(paymentWriteDeploymentReady(environment, confirmedBusinessRulesProfile), false, name);
    assert.ok(problems.includes(expectedProblem), `${name} must fail with ${expectedProblem}`);
  }
});
