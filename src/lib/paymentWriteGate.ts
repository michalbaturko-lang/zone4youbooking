import {
  businessRulesProfile,
  type BusinessRulesEnvironment,
  type BusinessRulesProfile,
} from "./businessRuleConfirmation";
import { deploymentPhase } from "./deploymentPreflight";
import { BookingApiError } from "./errors";
import { livePersonalizedAccessProblems } from "./liveAccessGate";
import { paymentConfigurationProblems } from "./paymentConfig";

export function paymentWriteDeploymentProblems(
  environment: BusinessRulesEnvironment = process.env,
  profile: BusinessRulesProfile = businessRulesProfile,
) {
  const problems = [
    ...livePersonalizedAccessProblems(environment, profile),
    ...paymentConfigurationProblems(environment, profile),
  ];

  if (deploymentPhase(environment) !== "booking_with_stripe") {
    problems.push("PAYMENT_DEPLOYMENT_PHASE");
  }

  return [...new Set(problems)].sort();
}

export function paymentWriteDeploymentReady(
  environment: BusinessRulesEnvironment = process.env,
  profile: BusinessRulesProfile = businessRulesProfile,
) {
  return paymentWriteDeploymentProblems(environment, profile).length === 0;
}

export function assertPaymentWriteDeploymentReady() {
  if (paymentWriteDeploymentReady()) return;
  throw new BookingApiError(
    503,
    "PAYMENTS_DISABLED",
    "Online dobití je do dokončení bezpečné platební konfigurace vypnuté.",
  );
}
