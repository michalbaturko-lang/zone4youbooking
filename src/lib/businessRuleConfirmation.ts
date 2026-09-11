import { createHash } from "node:crypto";
import rawBusinessRulesProfile from "../../config/business-rules-profile.json";
import { bookingRules } from "./bookingRules";
import type { BookingRules, FreeCancellationCutoff } from "./domain";

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

function cutoffMatches(profile: FreeCancellationCutoff, implementation: FreeCancellationCutoff) {
  if (profile.mode !== implementation.mode) return false;
  return profile.mode === "lesson_day_midnight"
    ? implementation.mode === "lesson_day_midnight" && profile.timeZone === implementation.timeZone
    : implementation.mode === "hours_before_start" && profile.hours === implementation.hours;
}

function reformerPolicyMatches(profile: BusinessRulesProfile, implementation: BookingRules) {
  const expected = profile.reformerCancellation;
  const actual = implementation.reformerCancellation;
  if (!expected || expected.mode !== actual.mode) return false;
  if (expected.mode === "same_as_group") return true;
  if (actual.mode !== "custom") return false;
  return cutoffMatches(expected.freeCancellationCutoff, actual.freeCancellationCutoff) &&
    expected.lateFeeKc === actual.lateCancelFeeKc &&
    expected.noShowFeeKc === actual.noShowFeeKc &&
    expected.lateCancellationAllowed === actual.lateCancellationAllowed;
}

export function businessRulesProfileMatchesImplementation(
  profile: BusinessRulesProfile = businessRulesProfile,
  implementation: BookingRules = bookingRules,
) {
  return (
    profile.status === "confirmed" &&
    typeof profile.profileId === "string" &&
    profile.profileId.trim().length > 0 &&
    profile.minimumCreditForReservationKc === implementation.minimumCreditForReservationKc &&
    profile.reservationHoldKc === implementation.reservationHoldKc &&
    profile.reservationWindow?.mode === "rolling_hours" &&
    profile.reservationWindow.hours === implementation.reservationWindowHours &&
    profile.groupCancellation !== null &&
    cutoffMatches(profile.groupCancellation.freeCancellationCutoff, implementation.freeCancellationCutoff) &&
    profile.groupCancellation.lateFeeKc === implementation.lateCancelFeeKc &&
    profile.groupCancellation.noShowFeeKc === implementation.noShowFeeKc &&
    profile.groupCancellation.lateCancellationAllowed === implementation.lateCancellationAllowed &&
    reformerPolicyMatches(profile, implementation)
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
