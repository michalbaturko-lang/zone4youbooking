import type { BusinessRulesProfile } from "./businessRuleConfirmation";
import type { BookingRules } from "./domain";
export function businessRulesMatch(profile: BusinessRulesProfile, implementation: BookingRules): boolean;
