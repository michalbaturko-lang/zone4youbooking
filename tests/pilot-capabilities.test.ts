import assert from "node:assert/strict";
import test from "node:test";
import { capabilitiesForMode } from "../src/lib/pilotCapabilities";

test("demo exposes simulated top-ups without claiming Stripe readiness", () => {
  assert.deepEqual(capabilitiesForMode("demo"), {
    reservationsEnabled: true,
    waitlistEnabled: true,
    topupsEnabled: true,
    topupMode: "demo",
    businessRulesStatus: "demo",
    favoritesSync: "device",
    forgotPasswordEnabled: false,
    englishEnabled: true,
  });
});

test("live mode fails closed until the verified Stripe flow exists", () => {
  const capabilities = capabilitiesForMode("live");
  assert.equal(capabilities.reservationsEnabled, false);
  assert.equal(capabilities.waitlistEnabled, false);
  assert.equal(capabilities.topupsEnabled, false);
  assert.equal(capabilities.topupMode, "disabled");
  assert.equal(capabilities.businessRulesStatus, "unconfirmed");
  assert.equal(capabilities.forgotPasswordEnabled, false);
});

test("live waitlist can only be enabled behind the booking mutation switch", () => {
  assert.equal(capabilitiesForMode("live", { waitlistEnabled: true }).waitlistEnabled, false);
  assert.deepEqual(
    capabilitiesForMode("live", { bookingMutationsEnabled: true, waitlistEnabled: true }),
    {
      reservationsEnabled: true,
      waitlistEnabled: true,
      topupsEnabled: false,
      topupMode: "disabled",
      businessRulesStatus: "unconfirmed",
      favoritesSync: "device",
      forgotPasswordEnabled: false,
      englishEnabled: true,
    },
  );
});

test("live Stripe top-ups require the booking switch and the complete payment runtime", () => {
  assert.equal(capabilitiesForMode("live", { stripeTopupsEnabled: true }).topupsEnabled, false);
  assert.deepEqual(
    capabilitiesForMode("live", { bookingMutationsEnabled: true, stripeTopupsEnabled: true }),
    {
      reservationsEnabled: true,
      waitlistEnabled: false,
      topupsEnabled: true,
      topupMode: "stripe",
      businessRulesStatus: "unconfirmed",
      favoritesSync: "device",
      forgotPasswordEnabled: false,
      englishEnabled: true,
    },
  );
});

test("live capabilities expose confirmed rules only after the exact server-side profile gate", () => {
  assert.equal(
    capabilitiesForMode("live", {
      bookingMutationsEnabled: true,
      businessRulesConfirmed: true,
    }).businessRulesStatus,
    "confirmed",
  );
});
