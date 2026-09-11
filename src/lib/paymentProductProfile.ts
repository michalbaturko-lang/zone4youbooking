import { createHash } from "node:crypto";
import rawPaymentProductProfile from "../../config/payment-product-profile.json";
import { bookingRules } from "./bookingRules";
import type { BusinessRulesEnvironment } from "./businessRuleConfirmation";

export interface PaymentProductProfile {
  profileId: string;
  status: "provisional" | "confirmed";
  currency: "CZK";
  allowedTopupAmountsKc: number[];
  decisionSources: string[];
}

export const paymentProductProfile = rawPaymentProductProfile as PaymentProductProfile;

export function paymentProductProfileSha256(profile: PaymentProductProfile = paymentProductProfile) {
  return createHash("sha256").update(JSON.stringify(profile), "utf8").digest("hex");
}

export function paymentProductProfileMatchesImplementation(
  profile: PaymentProductProfile = paymentProductProfile,
  implementedAmounts: number[] = bookingRules.topupAmounts,
) {
  const amounts = Array.isArray(profile.allowedTopupAmountsKc) ? profile.allowedTopupAmountsKc : [];
  const decisionSources = Array.isArray(profile.decisionSources) ? profile.decisionSources : [];
  return (
    profile.status === "confirmed" &&
    typeof profile.profileId === "string" &&
    profile.profileId.trim().length > 0 &&
    profile.currency === "CZK" &&
    decisionSources.length > 0 &&
    decisionSources.every((source) => typeof source === "string" && source.trim().length > 0) &&
    amounts.length > 0 &&
    amounts.every((amount) => Number.isSafeInteger(amount) && amount > 0) &&
    new Set(amounts).size === amounts.length &&
    amounts.every((amount, index) => index === 0 || amount > amounts[index - 1]) &&
    amounts.length === implementedAmounts.length &&
    amounts.every((amount, index) => amount === implementedAmounts[index])
  );
}

export function paymentProductRuntimeReady(
  environment: BusinessRulesEnvironment = process.env,
  profile: PaymentProductProfile = paymentProductProfile,
) {
  return (
    environment.PAYMENT_PRODUCT_CONFIRMED === "true" &&
    paymentProductProfileMatchesImplementation(profile) &&
    environment.PAYMENT_PRODUCT_PROFILE_SHA256 === paymentProductProfileSha256(profile)
  );
}
