import {
  businessRulesProfile,
  type BusinessRulesEnvironment,
  type BusinessRulesProfile,
} from "./businessRuleConfirmation";
import { deploymentPhase } from "./deploymentPreflight";
import { BookingApiError } from "./errors";
import { livePersonalizedAccessProblems } from "./liveAccessGate";

const bookingPhases = new Set(["booking_without_payments", "booking_with_stripe"]);

export function bookingWriteDeploymentProblems(
  environment: BusinessRulesEnvironment = process.env,
  profile: BusinessRulesProfile = businessRulesProfile,
) {
  const problems = livePersonalizedAccessProblems(environment, profile);

  if (!bookingPhases.has(deploymentPhase(environment))) {
    problems.push("BOOKING_DEPLOYMENT_PHASE");
  }

  return [...new Set(problems)].sort();
}

export function bookingWriteDeploymentReady(
  environment: BusinessRulesEnvironment = process.env,
  profile: BusinessRulesProfile = businessRulesProfile,
) {
  return bookingWriteDeploymentProblems(environment, profile).length === 0;
}

export function assertBookingWriteDeploymentReady() {
  if (bookingWriteDeploymentReady()) return;
  throw new BookingApiError(
    503,
    "BOOKING_DEPLOYMENT_NOT_READY",
    "Rezervace jsou do dokončení všech bezpečnostních kontrol vypnuté.",
  );
}
