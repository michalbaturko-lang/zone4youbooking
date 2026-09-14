import assert from "node:assert/strict";
import test from "node:test";
import {
  livePersonalizedAccessProblems,
  livePersonalizedAccessReady,
} from "../src/lib/liveAccessGate";
import {
  confirmedBusinessRulesEnvironment,
  confirmedBusinessRulesProfile,
} from "./testBusinessRules";

const commit = "1234567890abcdef1234567890abcdef12345678";

function readOnlyStagingEnvironment(overrides: Record<string, string | undefined> = {}) {
  return confirmedBusinessRulesEnvironment({
    ZONE4YOU_DEPLOYMENT_TARGET: "staging",
    ZONE4YOU_DEPLOYMENT_PHASE: "read_only",
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
    BOOKING_MUTATIONS_ENABLED: "false",
    PAYMENT_MUTATIONS_ENABLED: "false",
    ...overrides,
  });
}

test("live login and personalized reads require the complete secure deployment gate", () => {
  const ready = readOnlyStagingEnvironment();
  assert.equal(livePersonalizedAccessReady(ready, confirmedBusinessRulesProfile), true);
  assert.deepEqual(livePersonalizedAccessProblems(ready, confirmedBusinessRulesProfile), []);

  for (const [name, environment, expectedProblem] of [
    ["region", { ...ready, VERCEL_REGION: "iad1" }, "PERSONALIZED_DEPLOYMENT_REGION"],
    ["query logging", { ...ready, LUXART_LOGIN_QUERY_LOGGING_CONFIRMED: "false" }, "LUXART_LOGIN_QUERY_LOGGING_UNCONFIRMED"],
    ["gateway", { ...ready, LUXART_API_AUTH_CONFIRMED: "false" }, "LUXART_GATEWAY_AUTH"],
    ["notifications", { ...ready, LUXART_NOTIFICATION_TEMPLATES_CONFIRMED: "false" }, "LUXART_NOTIFICATION_TEMPLATES_UNCONFIRMED"],
    [
      "anonymous-only HTTP diagnostic",
      {
        ...ready,
        LUXART_API_BASE_URL: "http://luxart-test.example.com:9295/",
        LUXART_ALLOW_INSECURE_TEST_HTTP: "true",
      },
      "PERSONALIZED_HTTPS_REQUIRED",
    ],
  ] as const) {
    const problems = livePersonalizedAccessProblems(environment, confirmedBusinessRulesProfile);
    assert.equal(livePersonalizedAccessReady(environment, confirmedBusinessRulesProfile), false, name);
    assert.ok(problems.includes(expectedProblem), `${name} must fail with ${expectedProblem}`);
  }
});
