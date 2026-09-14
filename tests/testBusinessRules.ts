import {
  businessRulesProfileSha256,
  type BusinessRulesEnvironment,
  type BusinessRulesProfile,
} from "../src/lib/businessRuleConfirmation";

export const confirmedBusinessRulesProfile: BusinessRulesProfile = {
  profileId: "zone4you-test-confirmed-v1",
  status: "confirmed",
  minimumCreditForReservationKc: 200,
  reservationHoldKc: 100,
  reservationWindow: { mode: "rolling_hours", hours: 48 },
  groupCancellation: {
    freeCancellationCutoff: {
      mode: "lesson_day_midnight",
      timeZone: "Europe/Prague",
    },
    lateFeeKc: 100,
    noShowFeeKc: 100,
    lateCancellationAllowed: true,
  },
  reformerCancellation: { mode: "same_as_group" },
};

export function confirmedBusinessRulesEnvironment(
  overrides: BusinessRulesEnvironment = {},
): BusinessRulesEnvironment {
  return {
    BOOKING_RULES_CONFIRMED: "true",
    BOOKING_RULES_PROFILE_SHA256: businessRulesProfileSha256(confirmedBusinessRulesProfile),
    ...overrides,
  };
}
