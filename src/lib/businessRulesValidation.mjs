// Shared by runtime and the plain-Node launch checker. Neither may silently
// impose a different cancellation policy on the same signed-off profile.
function cutoffMatches(expected, actual) {
  if (!expected || !actual || expected.mode !== actual.mode) return false;
  if (expected.mode === "lesson_day_midnight") {
    return expected.timeZone === "Europe/Prague" && actual.timeZone === expected.timeZone;
  }
  return expected.mode === "hours_before_start" &&
    Number.isInteger(expected.hours) && expected.hours >= 1 && expected.hours <= 31 * 24 &&
    actual.hours === expected.hours;
}

function feeMatches(expected, actual) {
  return typeof expected === "number" && Number.isFinite(expected) && expected >= 0 && expected <= 1_000_000_000 && expected === actual;
}

function reformerMatches(expected, actual) {
  if (!expected || !actual || expected.mode !== actual.mode) return false;
  if (expected.mode === "same_as_group") return true;
  return expected.mode === "custom" &&
    cutoffMatches(expected.freeCancellationCutoff, actual.freeCancellationCutoff) &&
    feeMatches(expected.lateFeeKc, actual.lateCancelFeeKc) &&
    feeMatches(expected.noShowFeeKc, actual.noShowFeeKc) &&
    typeof expected.lateCancellationAllowed === "boolean" && expected.lateCancellationAllowed === actual.lateCancellationAllowed;
}

export function businessRulesMatch(profile, implementation) {
  if (!profile || !implementation) return false;
  const cancellation = profile.groupCancellation;
  const window = profile.reservationWindow;
  return profile.status === "confirmed" &&
    typeof profile.profileId === "string" && profile.profileId.trim().length > 0 &&
    feeMatches(profile.minimumCreditForReservationKc, implementation.minimumCreditForReservationKc) &&
    feeMatches(profile.reservationHoldKc, implementation.reservationHoldKc) &&
    window?.mode === "rolling_hours" && Number.isInteger(window.hours) && window.hours > 0 &&
    window.hours === implementation.reservationWindowHours &&
    cutoffMatches(cancellation?.freeCancellationCutoff, implementation.freeCancellationCutoff) &&
    feeMatches(cancellation?.lateFeeKc, implementation.lateCancelFeeKc) &&
    feeMatches(cancellation?.noShowFeeKc, implementation.noShowFeeKc) &&
    typeof cancellation?.lateCancellationAllowed === "boolean" &&
    cancellation.lateCancellationAllowed === implementation.lateCancellationAllowed &&
    reformerMatches(profile.reformerCancellation, implementation.reformerCancellation);
}
