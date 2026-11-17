import assert from "node:assert/strict";
import test from "node:test";
import { isBookingSnapshotResponse } from "../src/lib/bookingSnapshotValidation";
import { getBookingSnapshotForAdapter } from "../src/lib/bookingService";
import { mockLuxartAdapter, resetMockLuxartState } from "../src/lib/mockLuxart";
import { bookingRules } from "../src/lib/bookingRules";
import { capabilitiesForMode } from "../src/lib/pilotCapabilities";
import { bookingApiClient, BookingApiClientError } from "../src/lib/bookingApiClient";

test("snapshot boundary rejects invalid nested rendering data and accepts complete anonymous and account snapshots", async (context) => {
  resetMockLuxartState();
  const complete = { ...await getBookingSnapshotForAdapter(mockLuxartAdapter), rules: bookingRules, capabilities: capabilitiesForMode("demo") };
  assert.equal(isBookingSnapshotResponse(complete), true);
  await mockLuxartAdapter.login({ login: "Nováková", password: "2048" });
  assert.equal(isBookingSnapshotResponse({ ...await getBookingSnapshotForAdapter(mockLuxartAdapter), rules: bookingRules, capabilities: capabilitiesForMode("demo") }), true);
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; resetMockLuxartState(); });
  for (const invalid of [null, {}, { ...complete, rules: null }, { ...complete, lessons: [null] },
    { ...complete, lessons: [{ ...complete.lessons[0], instructorName: {} }] },
    { ...complete, capabilities: { ...complete.capabilities, englishEnabled: "true" } },
    { ...complete, user: { fullName: 42 } }]) {
    assert.equal(isBookingSnapshotResponse(invalid), false);
    globalThis.fetch = async () => new Response(JSON.stringify(invalid), { status: 200, headers: { "X-Request-ID": "snapshot-invalid-safe" } });
    await assert.rejects(bookingApiClient.snapshot(), (error: unknown) => error instanceof BookingApiClientError && error.code === "INVALID_RESPONSE" && error.requestId === "snapshot-invalid-safe");
  }
});
