import { BookingApiError } from "./errors";
import { validTlsPostgresUrl } from "./paymentConfig";
import {
  businessRulesProfile,
  businessRulesRuntimeReady,
  type BusinessRulesEnvironment,
  type BusinessRulesProfile,
} from "./businessRuleConfirmation";

export function bookingMutationsRequested(environment: BusinessRulesEnvironment = process.env) {
  return environment.BOOKING_MUTATIONS_ENABLED === "true";
}

export function bookingMutationConfigurationProblems(
  environment: BusinessRulesEnvironment = process.env,
  profile: BusinessRulesProfile = businessRulesProfile,
) {
  const problems: string[] = [];
  if (environment.LUXART_MOCK !== "false") problems.push("LUXART_LIVE_MODE");
  if (!bookingMutationsRequested(environment)) problems.push("BOOKING_MUTATIONS_DISABLED");
  if (!businessRulesRuntimeReady(environment, profile)) problems.push("BOOKING_RULES_UNCONFIRMED");
  if (environment.BOOKING_LEDGER_MODE !== "postgres") problems.push("BOOKING_LEDGER_MODE");
  if (!validTlsPostgresUrl(environment.BOOKING_DATABASE_URL)) problems.push("BOOKING_DATABASE_URL");
  return problems;
}

export function bookingMutationRuntimeReady(
  environment: BusinessRulesEnvironment = process.env,
  profile: BusinessRulesProfile = businessRulesProfile,
) {
  return bookingMutationConfigurationProblems(environment, profile).length === 0;
}

export function assertBookingMutationRuntimeReady() {
  if (bookingMutationRuntimeReady()) return;
  throw new BookingApiError(
    503,
    "BOOKING_MUTATION_LEDGER_DISABLED",
    "Rezervace jsou do dokončení bezpečné provozní konfigurace vypnuté.",
  );
}

export function bookingDatabaseUrl() {
  assertBookingMutationRuntimeReady();
  return process.env.BOOKING_DATABASE_URL!;
}
