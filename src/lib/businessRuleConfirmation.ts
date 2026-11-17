import { createHash } from "node:crypto";
import rawBusinessRulesProfile from "../../config/business-rules-profile.json";
import { bookingRules } from "./bookingRules";
import type { BookingRules, FreeCancellationCutoff } from "./domain";
import { businessRulesMatch } from "./businessRulesValidation.mjs";

export type BusinessRulesEnvironment = Record<string, string | undefined>;

export interface BusinessRulesProfile {
  profileId: string;
  status: "provisional" | "confirmed";
  minimumCreditForReservationKc: number;
  reservationHoldKc: number | null;
  reservationWindow: { mode: "rolling_hours"; hours: number } | null;
  groupCancellation: {
    freeCancellationCutoff: {
      mode: "lesson_day_midnight";
      timeZone: "Europe/Prague";
    };
    lateFeeKc: number | null;
    noShowFeeKc: number | null;
    lateCancellationAllowed: boolean | null;
  } | null;
  reformerCancellation: {
    mode: "same_as_group";
  } | {
    mode: "custom";
    freeCancellationCutoff: FreeCancellationCutoff;
    lateFeeKc: number;
    noShowFeeKc: number;
    lateCancellationAllowed: boolean;
  } | null;
}

export const businessRulesProfile = rawBusinessRulesProfile as BusinessRulesProfile;

export function businessRulesProfileSha256(profile: BusinessRulesProfile = businessRulesProfile) {
  return createHash("sha256").update(JSON.stringify(profile), "utf8").digest("hex");
}

export function businessRulesProfileMatchesImplementation(
  profile: BusinessRulesProfile = businessRulesProfile,
  implementation: BookingRules = bookingRules,
) {
  return businessRulesMatch(profile, implementation);
}

export function businessRulesRuntimeReady(
  environment: BusinessRulesEnvironment = process.env,
  profile: BusinessRulesProfile = businessRulesProfile,
) {
  return (
    environment.BOOKING_RULES_CONFIRMED === "true" &&
    businessRulesProfileMatchesImplementation(profile) &&
    environment.BOOKING_RULES_PROFILE_SHA256 === businessRulesProfileSha256(profile)
  );
}
