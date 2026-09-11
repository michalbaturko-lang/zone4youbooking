import assert from "node:assert/strict";
import test from "node:test";
import {
  paymentConfigurationProblems,
  paymentRuntimeReady,
  validTlsPostgresUrl,
} from "../src/lib/paymentConfig";
import {
  confirmedBusinessRulesEnvironment,
  confirmedBusinessRulesProfile,
} from "./testBusinessRules";
import { paymentProductProfileSha256 } from "../src/lib/paymentProductProfile";

test("payment runtime is fail-closed until every release dependency is explicit", () => {
  const environment = confirmedBusinessRulesEnvironment({
    LUXART_MOCK: "false",
    BOOKING_MUTATIONS_ENABLED: "true",
    BOOKING_LEDGER_MODE: "postgres",
    BOOKING_DATABASE_URL: "postgresql://booking@db.zone4you.cz/zone4you?sslmode=verify-full",
    PAYMENT_MUTATIONS_ENABLED: "true",
    APP_BASE_URL: "https://booking.zone4you.cz/",
    STRIPE_SECRET_KEY: "sk_test_zone4you_example",
    STRIPE_WEBHOOK_SECRET: "whsec_zone4you_example",
    STRIPE_LIVEMODE: "false",
    PAYMENT_LEDGER_MODE: "postgres",
    PAYMENT_DATABASE_URL: "postgresql://payments@db.zone4you.cz/zone4you?sslmode=verify-full",
    PAYMENT_PRODUCT_CONFIRMED: "true",
    PAYMENT_PRODUCT_PROFILE_SHA256: paymentProductProfileSha256(),
    LUXART_PAYMENT_MAPPING_CONFIRMED: "true",
    LUXART_STRIPE_PAYMENT_METHOD_ID: "3",
  });

  assert.equal(paymentRuntimeReady(environment, confirmedBusinessRulesProfile), true);
  assert.deepEqual(paymentConfigurationProblems(environment, confirmedBusinessRulesProfile), []);

  const disabled = { ...environment, PAYMENT_MUTATIONS_ENABLED: "false" };
  assert.equal(paymentRuntimeReady(disabled, confirmedBusinessRulesProfile), false);
  assert.ok(paymentConfigurationProblems(disabled, confirmedBusinessRulesProfile).includes("PAYMENT_MUTATIONS_DISABLED"));

  const staleProductProfile = { ...environment, PAYMENT_PRODUCT_PROFILE_SHA256: "stale" };
  assert.equal(paymentRuntimeReady(staleProductProfile, confirmedBusinessRulesProfile), false);
  assert.ok(paymentConfigurationProblems(staleProductProfile, confirmedBusinessRulesProfile).includes("PAYMENT_PRODUCT_PROFILE"));
});

test("payment database URL requires PostgreSQL over explicit TLS", () => {
  assert.equal(validTlsPostgresUrl("postgresql://db.example/zone4you?sslmode=require"), true);
  assert.equal(validTlsPostgresUrl("postgresql://db.example/zone4you"), false);
  assert.equal(validTlsPostgresUrl("http://db.example/zone4you?sslmode=require"), false);
  assert.equal(validTlsPostgresUrl("postgresql://db.example.invalid/zone4you?sslmode=require"), false);
});
