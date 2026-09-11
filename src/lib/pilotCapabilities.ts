import type { BookingCapabilities } from "./domain";
import { bookingMutationRuntimeReady } from "./bookingMutationConfig";
import { paymentRuntimeReady } from "./paymentConfig";
import { businessRulesRuntimeReady } from "./businessRuleConfirmation";

export function capabilitiesForMode(
  mode: "demo" | "live",
  options: {
    bookingMutationsEnabled?: boolean;
    waitlistEnabled?: boolean;
    stripeTopupsEnabled?: boolean;
    businessRulesConfirmed?: boolean;
  } = {},
): BookingCapabilities {
  const mutationsEnabled = mode === "demo" || options.bookingMutationsEnabled === true;
  const stripeTopupsEnabled = mode === "live" && mutationsEnabled && options.stripeTopupsEnabled === true;
  return {
    reservationsEnabled: mutationsEnabled,
    waitlistEnabled: mutationsEnabled && (mode === "demo" || options.waitlistEnabled === true),
    topupsEnabled: mode === "demo" || stripeTopupsEnabled,
    topupMode: mode === "demo" ? "demo" : stripeTopupsEnabled ? "stripe" : "disabled",
    businessRulesStatus: mode === "demo" ? "demo" : options.businessRulesConfirmed === true ? "confirmed" : "unconfirmed",
    favoritesSync: "device",
    forgotPasswordEnabled: false,
    englishEnabled: true,
  };
}

export function getPilotCapabilities(): BookingCapabilities {
  const bookingReady = process.env.LUXART_MOCK !== "false" || bookingMutationRuntimeReady();
  const rulesConfirmed = businessRulesRuntimeReady();
  return capabilitiesForMode(process.env.LUXART_MOCK === "false" ? "live" : "demo", {
    bookingMutationsEnabled: bookingReady,
    waitlistEnabled: process.env.LUXART_WAITLIST_ENABLED === "true",
    stripeTopupsEnabled: paymentRuntimeReady(),
    businessRulesConfirmed: rulesConfirmed,
  });
}
