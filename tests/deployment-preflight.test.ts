import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeploymentPreflightReport,
  deploymentCliOnlyVariables,
  deploymentRuntimeConfigurationProblems,
  runtimeDeploymentRegion,
} from "../src/lib/deploymentPreflight";
import { paymentProductProfileSha256 } from "../src/lib/paymentProductProfile";
import { luxartResourceMappingSha256 } from "../src/lib/luxartResourceMappingFingerprint";
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
    LUXART_API_CONTRACT: "memberzone_rest_v1",
    LUXART_API_BASE_URL: "https://luxart-test.example.com:9759/",
    LUXART_ALLOW_INSECURE_TEST_HTTP: "false",
    LUXART_RESORT_ID: "1",
    LUXART_TIMEOUT_MS: "12000",
    LUXART_API_AUTH_MODE: "none",
    LUXART_API_AUTH_CONFIRMED: "true",
    RATE_LIMIT_MODE: "memory",
    RATE_LIMIT_SINGLE_INSTANCE: "true",
    SESSION_SECRET: fakeSessionSecret,
    NOTIFICATION_PROVIDER: "luxart",
    LUXART_NOTIFICATION_TEMPLATES_CONFIRMED: "true",
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
  assert.equal(report.configuration.luxartApiContract, "memberzone_rest_v1");
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

test("incomplete booking readiness does not publish an unverified resource mapping", async () => {
  const resourceMapJson = JSON.stringify({ 1: 101, 2: 102, 3: 203 });
  const environment = bookingStagingEnvironment({
    LUXART_RESOURCE_MAP_JSON: resourceMapJson,
    RATE_LIMIT_MODE: "postgres",
    RATE_LIMIT_DATABASE_URL: "postgresql://test:test@127.0.0.1:1/zone4you?sslmode=require",
    VERCEL_REGION: "fra1",
  });
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(environment)) {
    previous.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  try {
    const { GET } = await import("../src/app/api/readiness/route");
    const response = await GET();
    const body = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 503);
    assert.equal(body.status, "not_ready");
    assert.equal(body.configuration, "incomplete");
    assert.equal(body.resourceMapSha256, undefined);
    assert.match(luxartResourceMappingSha256(resourceMapJson), /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(body).includes(resourceMapJson), false);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
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

  const watchdogEnabled = buildDeploymentPreflightReport(
    bookingStagingEnvironment({ LUXART_WAITLIST_ENABLED: "true" }),
    { profile: confirmedBusinessRulesProfile, expectedCommit: commit },
  );
  assert.equal(watchdogEnabled.ok, false);
  assert.ok(watchdogEnabled.issues.some(({ code }) => code === "WAITLIST_MUST_BE_DISABLED"));
});

test("preflight requires explicit confirmation of live Luxart notification templates", () => {
  for (const value of [undefined, "false", "yes"]) {
    const report = buildDeploymentPreflightReport(readOnlyStagingEnvironment({
      LUXART_NOTIFICATION_TEMPLATES_CONFIRMED: value,
    }));
    assert.equal(report.ok, false);
    assert.equal(report.configuration.notifications, "invalid");
    assert.ok(report.issues.some(({ code, variables }) =>
      code === "LUXART_NOTIFICATION_TEMPLATES_UNCONFIRMED" &&
      variables.includes("LUXART_NOTIFICATION_TEMPLATES_CONFIRMED")));
  }

  const wrongOwner = buildDeploymentPreflightReport(readOnlyStagingEnvironment({
    NOTIFICATION_PROVIDER: "application",
  }));
  assert.equal(wrongOwner.configuration.notifications, "invalid");
  assert.ok(wrongOwner.issues.some(({ code }) => code === "NOTIFICATION_PROVIDER"));
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
  const requiredOperatorOnlyVariables = [
    "LUXART_REQUIRE_AUTHENTICATED_PROBE",
    "ZONE4YOU_ALERT_EVIDENCE_PATH",
    "ZONE4YOU_BOOKING_UAT_EVIDENCE_PATH",
    "ZONE4YOU_LUXART_EVIDENCE_PATH",
    "ZONE4YOU_RELEASE_DOSSIER_OUTPUT_PATH",
    "ZONE4YOU_RELEASE_ID",
    "ZONE4YOU_RELEASE_MAXIMUM_EVIDENCE_AGE_HOURS",
    "ZONE4YOU_RELEASE_WINDOW_ENDS_AT",
    "ZONE4YOU_RELEASE_WINDOW_STARTS_AT",
    "ZONE4YOU_ROLLBACK_EVIDENCE_PATH",
    "ZONE4YOU_ROLLBACK_EXPECTED_COMMIT",
    "ZONE4YOU_ROLLBACK_TIMER_OUTPUT_PATH",
    "ZONE4YOU_ROLLBACK_TIMER_CAPTURE_CONFIRMATION",
    "ZONE4YOU_ROLLBACK_TIMER_EVIDENCE_PATH",
    "ZONE4YOU_ROLLBACK_TIMER_VERIFY_CONFIRMATION",
    "ZONE4YOU_RUNTIME_EVIDENCE_PATH",
    "ZONE4YOU_STRIPE_UAT_EVIDENCE_PATH",
    "PROBE_REQUIRE_REFORMER",
    "PROBE_TIMEOUT_MS",
    "VERCEL_PROTECTION_BYPASS",
    "PLAYWRIGHT_EXTERNAL_DEMO_URL",
    "PLAYWRIGHT_EXPECTED_DEMO_COMMIT",
  ] as const;
  for (const name of requiredOperatorOnlyVariables) {
    assert.ok(deploymentCliOnlyVariables.includes(name), `${name} must remain CLI-only`);
  }

  const sensitiveValues = {
    SESSION_SECRET: fakeSessionSecret,
    LUXART_API_BASE_URL: "https://private-luxart-gateway.example.com:9759/",
    RATE_LIMIT_DATABASE_URL: "postgresql://fake-rate-limit-secret@example.com/zone4you?sslmode=require",
    NEXT_PUBLIC_API_TOKEN: "fake-public-token-that-must-not-be-echoed",
    ZONE4YOU_UAT_PASSWORD: "fake-uat-password-that-must-not-be-echoed",
    ZONE4YOU_PRECUTOVER_EVIDENCE_PATH: "/secure/private-precutover-evidence.json",
    ZONE4YOU_RUNTIME_EVIDENCE_PATH: "/secure/private-runtime-evidence.json",
    ZONE4YOU_RELEASE_WINDOW_STARTS_AT: "2026-09-15T20:00:00.000Z",
    VERCEL_PROTECTION_BYPASS: "fake-preview-bypass-secret",
    PLAYWRIGHT_EXTERNAL_DEMO_URL: "https://private-preview.example.com/",
    LUXART_REQUIRE_AUTHENTICATED_PROBE: "true",
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

  const anonymousHttpDiagnostic = buildDeploymentPreflightReport(readOnlyStagingEnvironment({
    LUXART_API_BASE_URL: "http://luxart-test.example.com:9295/",
    LUXART_ALLOW_INSECURE_TEST_HTTP: "true",
  }));
  assert.equal(anonymousHttpDiagnostic.ok, true);
  assert.equal(anonymousHttpDiagnostic.configuration.luxartTransport, "approved_test_http");

  const insecureBooking = deploymentRuntimeConfigurationProblems(bookingStagingEnvironment({
    LUXART_API_BASE_URL: "http://luxart-test.example.com:9191/",
    LUXART_ALLOW_INSECURE_TEST_HTTP: "true",
  }), confirmedBusinessRulesProfile);
  assert.ok(insecureBooking.some(({ code }) => code === "INSECURE_HTTP_READ_ONLY_ONLY"));

  const insecureGatewayAuth = deploymentRuntimeConfigurationProblems(readOnlyStagingEnvironment({
    LUXART_API_BASE_URL: "http://luxart-test.example.com:9191/",
    LUXART_ALLOW_INSECURE_TEST_HTTP: "true",
    LUXART_API_AUTH_MODE: "basic",
    LUXART_API_BASIC_USERNAME: "gateway-user",
    LUXART_API_BASIC_PASSWORD: "gateway-password",
  }));
  assert.ok(insecureGatewayAuth.some(({ code }) => code === "INSECURE_HTTP_GATEWAY_AUTH"));

  const nestedApiPath = deploymentRuntimeConfigurationProblems(readOnlyStagingEnvironment({
    LUXART_API_BASE_URL: "https://luxart-test.example.com:9191/api/",
  }));
  assert.ok(nestedApiPath.some(({ code }) => code === "LUXART_API_TRANSPORT"));

  const ambiguousApiContract = deploymentRuntimeConfigurationProblems(readOnlyStagingEnvironment({
    LUXART_API_CONTRACT: "soap_wcf",
  }));
  assert.ok(ambiguousApiContract.some(({ code }) => code === "LUXART_API_CONTRACT"));

  for (const [name, value] of [
    ["LUXART_ROOM_MAP_JSON", JSON.stringify({ room: "Cycling" })],
    ["LUXART_ROOM_MAP_EN_JSON", JSON.stringify({ 2: 42 })],
    ["LUXART_LESSON_TYPE_MAP_JSON", JSON.stringify({ 8: "" })],
    ["LUXART_LESSON_TYPE_MAP_EN_JSON", "[]"],
  ] as const) {
    const invalidDisplayMap = deploymentRuntimeConfigurationProblems(readOnlyStagingEnvironment({ [name]: value }));
    assert.ok(invalidDisplayMap.some(({ code }) => code === name));
  }
});
