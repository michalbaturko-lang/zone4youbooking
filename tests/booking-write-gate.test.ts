import assert from "node:assert/strict";
import test from "node:test";
import {
  bookingWriteDeploymentProblems,
  bookingWriteDeploymentReady,
} from "../src/lib/bookingWriteGate";
import {
  confirmedBusinessRulesEnvironment,
  confirmedBusinessRulesProfile,
} from "./testBusinessRules";

const commit = "1234567890abcdef1234567890abcdef12345678";

function bookingStagingEnvironment(overrides: Record<string, string | undefined> = {}) {
  return confirmedBusinessRulesEnvironment({
    ZONE4YOU_DEPLOYMENT_TARGET: "staging",
    ZONE4YOU_DEPLOYMENT_PHASE: "booking_without_payments",
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
    LUXART_RESOURCE_MAP_JSON: JSON.stringify({ 1: 101, 2: 102, 3: 203 }),
    RATE_LIMIT_MODE: "memory",
    RATE_LIMIT_SINGLE_INSTANCE: "true",
    SESSION_SECRET: "fake-session-secret-for-tests-2026-A9",
    NOTIFICATION_PROVIDER: "luxart",
    LUXART_NOTIFICATION_TEMPLATES_CONFIRMED: "true",
    LUXART_WAITLIST_ENABLED: "false",
    LUXART_WATCHDOG_VARIANT: "watchdog_III",
    BOOKING_MUTATIONS_ENABLED: "true",
    BOOKING_LEDGER_MODE: "postgres",
    BOOKING_DATABASE_URL: "postgresql://fake-booking-db.example.com/zone4you?sslmode=require",
    PAYMENT_MUTATIONS_ENABLED: "false",
    ...overrides,
  });
}

test("live writes require the complete booking deployment gate", () => {
  const ready = bookingStagingEnvironment();
  assert.equal(bookingWriteDeploymentReady(ready, confirmedBusinessRulesProfile), true);
  assert.deepEqual(bookingWriteDeploymentProblems(ready, confirmedBusinessRulesProfile), []);

  for (const [name, environment, expectedProblem] of [
    ["region", { ...ready, VERCEL_REGION: "iad1" }, "BOOKING_DEPLOYMENT_REGION"],
    ["phase", { ...ready, ZONE4YOU_DEPLOYMENT_PHASE: "read_only" }, "BOOKING_DEPLOYMENT_PHASE"],
    ["notifications", { ...ready, LUXART_NOTIFICATION_TEMPLATES_CONFIRMED: "false" }, "LUXART_NOTIFICATION_TEMPLATES_UNCONFIRMED"],
    ["resource map", { ...ready, LUXART_RESOURCE_MAP_JSON: undefined }, "LUXART_RESOURCE_MAP_JSON"],
    ["gateway confirmation", { ...ready, LUXART_API_AUTH_CONFIRMED: "false" }, "LUXART_GATEWAY_AUTH"],
  ] as const) {
    const problems = bookingWriteDeploymentProblems(environment, confirmedBusinessRulesProfile);
    assert.equal(bookingWriteDeploymentReady(environment, confirmedBusinessRulesProfile), false, name);
    assert.ok(problems.includes(expectedProblem), `${name} must fail with ${expectedProblem}`);
  }
});
