import assert from "node:assert/strict";
import test from "node:test";
import {
  bookingMutationConfigurationProblems,
  bookingMutationRuntimeReady,
} from "../src/lib/bookingMutationConfig";
import {
  confirmedBusinessRulesEnvironment,
  confirmedBusinessRulesProfile,
} from "./testBusinessRules";

test("live booking mutations fail closed until the durable TLS ledger is configured", () => {
  const environment = confirmedBusinessRulesEnvironment({
    LUXART_MOCK: "false",
    BOOKING_MUTATIONS_ENABLED: "true",
    BOOKING_LEDGER_MODE: "postgres",
    BOOKING_DATABASE_URL: "postgresql://booking@db.zone4you.cz/zone4you?sslmode=verify-full",
  });
  assert.equal(bookingMutationRuntimeReady(environment, confirmedBusinessRulesProfile), true);
  assert.deepEqual(bookingMutationConfigurationProblems(environment, confirmedBusinessRulesProfile), []);

  const withoutDatabase = { ...environment, BOOKING_DATABASE_URL: undefined };
  assert.equal(bookingMutationRuntimeReady(withoutDatabase, confirmedBusinessRulesProfile), false);
  assert.ok(bookingMutationConfigurationProblems(withoutDatabase, confirmedBusinessRulesProfile).includes("BOOKING_DATABASE_URL"));

  const withoutRuleApproval = { ...environment, BOOKING_RULES_CONFIRMED: "false" };
  assert.equal(bookingMutationRuntimeReady(withoutRuleApproval, confirmedBusinessRulesProfile), false);
  assert.ok(bookingMutationConfigurationProblems(withoutRuleApproval, confirmedBusinessRulesProfile).includes("BOOKING_RULES_UNCONFIRMED"));
});
