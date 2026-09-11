import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeploymentPreflightReport,
  deploymentRuntimeConfigurationProblems,
  runtimeDeploymentRegion,
} from "../src/lib/deploymentPreflight";
import { paymentProductProfileSha256 } from "../src/lib/paymentProductProfile";
import {
  confirmedBusinessRulesEnvironment,
  confirmedBusinessRulesProfile,
} from "./testBusinessRules";

const commit = "1234567890abcdef1234567890abcdef12345678";
const fakeSessionSecret = "fake-session-secret-for-tests-2026-A9";

function readOnlyStagingEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    ZONE4YOU_DEPLOYMENT_TARGET: "staging",
    ZONE4YOU_DEPLOYMENT_PHASE: "read_only",
    ZONE4YOU_DEPLOYMENT_COMMIT: commit,
    ZONE4YOU_STAGING_APP_ORIGIN: "https://staging.booking.zone4you.cz/",
    NEXT_PUBLIC_APP_ENV: "staging",
    APP_BASE_URL: "https://staging.booking.zone4you.cz/",
    LUXART_MOCK: "false",
    LUXART_API_BASE_URL: "https://luxart-test.example.com:9759/api/",
    LUXART_ALLOW_INSECURE_TEST_HTTP: "false",
    LUXART_RESORT_ID: "1",
    LUXART_TIMEOUT_MS: "12000",
    LUXART_API_AUTH_MODE: "none",
    LUXART_API_AUTH_CONFIRMED: "true",
    RATE_LIMIT_MODE: "memory",
    RATE_LIMIT_SINGLE_INSTANCE: "true",
    SESSION_SECRET: fakeSessionSecret,
    NOTIFICATION_PROVIDER: "luxart",
    LUXART_WAITLIST_ENABLED: "false",
    LUXART_WATCHDOG_VARIANT: "watchdog_III",
    BOOKING_MUTATIONS_ENABLED: "false",
    PAYMENT_MUTATIONS_ENABLED: "false",
    ...overrides,
  };
}

function bookingStagingEnvironment(overrides: Record<string, string | undefined> = {}) {
  return confirmedBusinessRulesEnvironment({
    ...readOnlyStagingEnvironment(),
    ZONE4YOU_DEPLOYMENT_PHASE: "booking_without_payments",
    LUXART_RESOURCE_MAP_JSON: JSON.stringify({ 1: 101, 2: 102, 3: 203 }),
    BOOKING_MUTATIONS_ENABLED: "true",
    BOOKING_LEDGER_MODE: "postgres",
    BOOKING_DATABASE_URL: "postgresql://fake-booking-db.example.com/zone4you?sslmode=require",
    ...overrides,
  });
}

test("read-only staging preflight and live runtime region gate fail closed", async () => {
  const report = buildDeploymentPreflightReport(readOnlyStagingEnvironment(), {
    expectedCommit: commit,
    now: new Date("2026-08-30T10:00:00.000Z"),
  });
  assert.equal(report.ok, true);
  assert.equal(report.phase, "read_only");
  assert.equal(report.configuration.bookingMutations, "disabled");
  assert.equal(report.configuration.payments, "disabled");
  assert.equal(report.commit, commit);
  assert.deepEqual(report.issues, []);
  assert.equal(runtimeDeploymentRegion({ VERCEL_REGION: " FRA1 " }), "fra1");
  assert.equal(runtimeDeploymentRegion({}), "unknown");

  const previousMock = process.env.LUXART_MOCK;
  const previousRegion = process.env.VERCEL_REGION;
  try {
    process.env.LUXART_MOCK = "false";
    process.env.VERCEL_REGION = "iad1";
    const { GET } = await import("../src/app/api/readiness/route");
    const response = await GET();
    const body = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 503);
    assert.equal(body.status, "not_ready");
    assert.equal(body.region, "iad1");
    assert.equal(body.deployment, "unapproved_region");
    assert.equal(body.luxart, "not_checked");
  } finally {
    if (previousMock === undefined) delete process.env.LUXART_MOCK;
    else process.env.LUXART_MOCK = previousMock;
    if (previousRegion === undefined) delete process.env.VERCEL_REGION;
    else process.env.VERCEL_REGION = previousRegion;
  }
});

test("booking staging preflight requires and accepts confirmed rules, mapping and durable ledger", () => {
  const report = buildDeploymentPreflightReport(bookingStagingEnvironment(), {
    profile: confirmedBusinessRulesProfile,
    expectedCommit: commit,
  });
  assert.equal(report.ok, true);
  assert.equal(report.phase, "booking_without_payments");
  assert.equal(report.configuration.bookingMutations, "enabled");
  assert.equal(report.configuration.payments, "disabled");
  assert.equal(report.profiles.businessRulesStatus, "confirmed");
});

test("Stripe staging preflight accepts only the fully signed and durable payment phase", () => {
  const environment = bookingStagingEnvironment({
    ZONE4YOU_DEPLOYMENT_PHASE: "booking_with_stripe",
    PAYMENT_MUTATIONS_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_test_fake_zone4you_secret",
    STRIPE_WEBHOOK_SECRET: "whsec_fake_zone4you_secret",
    STRIPE_LIVEMODE: "false",
    PAYMENT_LEDGER_MODE: "postgres",
    PAYMENT_DATABASE_URL: "postgresql://fake-payment-db.example.com/zone4you?sslmode=require",
    PAYMENT_PRODUCT_CONFIRMED: "true",
    PAYMENT_PRODUCT_PROFILE_SHA256: paymentProductProfileSha256(),
    LUXART_PAYMENT_MAPPING_CONFIRMED: "true",
    LUXART_STRIPE_PAYMENT_METHOD_ID: "42",
  });
  const report = buildDeploymentPreflightReport(environment, {
    profile: confirmedBusinessRulesProfile,
    expectedCommit: commit,
  });
  assert.equal(report.ok, true);
  assert.equal(report.phase, "booking_with_stripe");
  assert.equal(report.configuration.payments, "enabled");
  assert.equal(report.profiles.paymentProductStatus, "confirmed");
});

test("preflight report never echoes configured secrets, database URLs or Luxart endpoint", () => {
  const sensitiveValues = {
    SESSION_SECRET: fakeSessionSecret,
    LUXART_API_BASE_URL: "https://private-luxart-gateway.example.com:9759/api/",
    RATE_LIMIT_DATABASE_URL: "postgresql://fake-rate-limit-secret@example.com/zone4you?sslmode=require",
    NEXT_PUBLIC_API_TOKEN: "fake-public-token-that-must-not-be-echoed",
    ZONE4YOU_UAT_PASSWORD: "fake-uat-password-that-must-not-be-echoed",
  };
  const environment = readOnlyStagingEnvironment({
    ...sensitiveValues,
    RATE_LIMIT_MODE: "postgres",
  });
  const serialized = JSON.stringify(buildDeploymentPreflightReport(environment));
  for (const value of Object.values(sensitiveValues)) assert.equal(serialized.includes(value), false);
  assert.match(serialized, /PUBLIC_SECRET_VARIABLE/);
  assert.match(serialized, /CLI_ONLY_VARIABLE_DEPLOYED/);
});

test("preflight fails closed on commit drift, phase drift and production HTTP override", () => {
  const commitDrift = buildDeploymentPreflightReport(readOnlyStagingEnvironment(), {
    expectedCommit: "a".repeat(40),
  });
  assert.equal(commitDrift.ok, false);
  assert.ok(commitDrift.issues.some(({ code }) => code === "DEPLOYMENT_COMMIT_MISMATCH"));

  const phaseDrift = deploymentRuntimeConfigurationProblems(readOnlyStagingEnvironment({
    ZONE4YOU_DEPLOYMENT_PHASE: "booking_without_payments",
  }), confirmedBusinessRulesProfile);
  assert.ok(phaseDrift.some(({ code }) => code === "BOOKING_MUTATIONS_DISABLED"));

  const productionOverride = deploymentRuntimeConfigurationProblems(readOnlyStagingEnvironment({
    ZONE4YOU_DEPLOYMENT_TARGET: "production",
    NEXT_PUBLIC_APP_ENV: "production",
    APP_BASE_URL: "https://booking.zone4you.cz/",
    LUXART_ALLOW_INSECURE_TEST_HTTP: "true",
  }));
  assert.ok(productionOverride.some(({ code }) => code === "PRODUCTION_INSECURE_HTTP_OVERRIDE"));
});
