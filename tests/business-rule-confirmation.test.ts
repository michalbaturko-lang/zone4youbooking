import assert from "node:assert/strict";
import test from "node:test";
import {
  businessRulesProfile,
  businessRulesProfileMatchesImplementation,
  businessRulesRuntimeReady,
} from "../src/lib/businessRuleConfirmation";
import {
  confirmedBusinessRulesEnvironment,
  confirmedBusinessRulesProfile,
} from "./testBusinessRules";
import { bookingRules } from "../src/lib/bookingRules";
import type { BookingRules } from "../src/lib/domain";

test("checked-in business rules record the free-cancellation midnight but stay provisional", () => {
  assert.equal(businessRulesProfile.status, "provisional");
  assert.equal(businessRulesProfile.minimumCreditForReservationKc, 200);
  assert.equal(businessRulesProfile.reservationWindow, null);
  assert.deepEqual(businessRulesProfile.groupCancellation, {
    freeCancellationCutoff: {
      mode: "lesson_day_midnight",
      timeZone: "Europe/Prague",
    },
    lateFeeKc: null,
    noShowFeeKc: null,
    lateCancellationAllowed: null,
  });
  assert.equal(businessRulesProfile.reformerCancellation, null);
  assert.equal(businessRulesProfileMatchesImplementation(), false);
  assert.equal(businessRulesRuntimeReady({
    BOOKING_RULES_CONFIRMED: "true",
    BOOKING_RULES_PROFILE_SHA256: "not-the-profile-digest",
  }), false);
});

test("a confirmed profile must match both implementation values and its exact digest", () => {
  const environment = confirmedBusinessRulesEnvironment();
  assert.equal(businessRulesProfileMatchesImplementation(confirmedBusinessRulesProfile), true);
  assert.equal(businessRulesRuntimeReady(environment, confirmedBusinessRulesProfile), true);
  assert.equal(
    businessRulesRuntimeReady(
      { ...environment, BOOKING_RULES_PROFILE_SHA256: "stale" },
      confirmedBusinessRulesProfile,
    ),
    false,
  );
  assert.equal(
    businessRulesRuntimeReady(environment, {
      ...confirmedBusinessRulesProfile,
      reservationWindow: { mode: "rolling_hours", hours: 24 },
    }),
    false,
  );
});

test("a custom Reformer cancellation policy must match every implemented value", () => {
  const reformerCancellation = {
    mode: "custom" as const,
    freeCancellationCutoff: { mode: "hours_before_start" as const, hours: 24 },
    lateFeeKc: 320,
    noShowFeeKc: 320,
    lateCancellationAllowed: false,
  };
  const profile = {
    ...confirmedBusinessRulesProfile,
    reformerCancellation,
  };
  const implementation: BookingRules = {
    ...bookingRules,
    reformerCancellation: {
      mode: "custom",
      freeCancellationCutoff: reformerCancellation.freeCancellationCutoff,
      lateCancelFeeKc: reformerCancellation.lateFeeKc,
      noShowFeeKc: reformerCancellation.noShowFeeKc,
      lateCancellationAllowed: reformerCancellation.lateCancellationAllowed,
    },
  };

  assert.equal(businessRulesProfileMatchesImplementation(profile, implementation), true);
  assert.equal(
    businessRulesProfileMatchesImplementation(
      { ...profile, reformerCancellation: { ...reformerCancellation, lateFeeKc: 200 } },
      implementation,
    ),
    false,
  );
});
