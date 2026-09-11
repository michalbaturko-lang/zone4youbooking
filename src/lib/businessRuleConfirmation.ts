import { createHash } from "node:crypto";
import rawBusinessRulesProfile from "../../config/business-rules-profile.json";
import { bookingRules } from "./bookingRules";

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
  reformerCancellation: { mode: "same_as_group" } | null;
}

export const businessRulesProfile = rawBusinessRulesProfile as BusinessRulesProfile;

export function businessRulesProfileSha256(profile: BusinessRulesProfile = businessRulesProfile) {
  return createHash("sha256").update(JSON.stringify(profile), "utf8").digest("hex");
}

export function businessRulesProfileMatchesImplementation(profile: BusinessRulesProfile = businessRulesProfile) {
  return (
    profile.status === "confirmed" &&
    typeof profile.profileId === "string" &&
    profile.profileId.trim().length > 0 &&
    profile.minimumCreditForReservationKc === bookingRules.minimumCreditForReservationKc &&
    profile.reservationHoldKc === bookingRules.reservationHoldKc &&
    profile.reservationWindow?.mode === "rolling_hours" &&
    profile.reservationWindow.hours === bookingRules.reservationWindowHours &&
    profile.groupCancellation?.freeCancellationCutoff.mode === bookingRules.freeCancellationCutoff.mode &&
    profile.groupCancellation.freeCancellationCutoff.timeZone === bookingRules.freeCancellationCutoff.timeZone &&
    profile.groupCancellation.lateFeeKc === bookingRules.lateCancelFeeKc &&
    profile.groupCancellation.noShowFeeKc === bookingRules.noShowFeeKc &&
    profile.groupCancellation.lateCancellationAllowed === true &&
    profile.reformerCancellation?.mode === "same_as_group"
  );
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
