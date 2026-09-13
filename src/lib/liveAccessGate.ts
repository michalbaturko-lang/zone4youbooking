import {
  businessRulesProfile,
  type BusinessRulesEnvironment,
  type BusinessRulesProfile,
} from "./businessRuleConfirmation";
import {
  approvedRuntimeRegion,
  deploymentRuntimeConfigurationProblems,
  runtimeDeploymentRegion,
} from "./deploymentPreflight";
import { BookingApiError } from "./errors";

function usesHttpsLuxartOrigin(environment: BusinessRulesEnvironment) {
  try {
    return new URL(environment.LUXART_API_BASE_URL ?? "").protocol === "https:";
  } catch {
    return false;
  }
}

export function livePersonalizedAccessProblems(
  environment: BusinessRulesEnvironment = process.env,
  profile: BusinessRulesProfile = businessRulesProfile,
) {
  const problems = deploymentRuntimeConfigurationProblems(environment, profile)
    .map(({ code }) => code);

  if (runtimeDeploymentRegion(environment) !== approvedRuntimeRegion) {
    problems.push("PERSONALIZED_DEPLOYMENT_REGION");
  }
  if (!usesHttpsLuxartOrigin(environment)) {
    problems.push("PERSONALIZED_HTTPS_REQUIRED");
  }

  return [...new Set(problems)].sort();
}

export function livePersonalizedAccessReady(
  environment: BusinessRulesEnvironment = process.env,
  profile: BusinessRulesProfile = businessRulesProfile,
) {
  return livePersonalizedAccessProblems(environment, profile).length === 0;
}

export function assertLivePersonalizedAccessReady() {
  if (livePersonalizedAccessReady()) return;
  throw new BookingApiError(
    503,
    "PERSONALIZED_ACCESS_NOT_READY",
    "Přihlášení a klientská data jsou do dokončení bezpečnostních kontrol vypnuté.",
  );
}
