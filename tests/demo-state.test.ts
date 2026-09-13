import assert from "node:assert/strict";
import test from "node:test";
import { isSafeMockLuxartState, maximumStoredDemoStateBytes, safeSerializedDemoState } from "../src/lib/demoState";
import { getMockLuxartState, resetMockLuxartState } from "../src/lib/mockLuxart";
import { restoreDemoState } from "../src/lib/demoStateTransport";

test("demo state accepts the canonical mock snapshot and stays below the request limit", () => {
  resetMockLuxartState();
  const state = getMockLuxartState();
  const serialized = safeSerializedDemoState(state);
  assert.equal(isSafeMockLuxartState(state), true);
  assert.ok(serialized);
  assert.ok(new TextEncoder().encode(serialized).byteLength <= maximumStoredDemoStateBytes);
});

test("demo state rejects malformed, unbounded and UI-breaking browser data", () => {
  resetMockLuxartState();
  const state = getMockLuxartState();
  for (const invalid of [
    { ...state, loggedIn: "true" },
    { ...state, userState: { ...state.userState, fullName: "x".repeat(201) } },
    { ...state, reservations: [{}] },
    { ...state, waitlist: Array.from({ length: 513 }, () => state.waitlist[0]) },
    { ...state, occupiedCounts: { ...state.occupiedCounts, unsafe: -1 } },
  ]) {
    assert.equal(isSafeMockLuxartState(invalid), false);
    assert.equal(safeSerializedDemoState(invalid), undefined);
  }
});

test("demo state rejects an otherwise valid snapshot above the transport budget", () => {
  resetMockLuxartState();
  const state = getMockLuxartState();
  const transaction = state.transactions[0];
  const oversized = {
    ...state,
    loggedIn: true,
    transactions: Array.from({ length: 80 }, (_, index) => ({
      ...transaction,
      id: `trx_oversized_${index}`,
      note: "x".repeat(1_000),
    })),
  };

  assert.equal(isSafeMockLuxartState(oversized), true);
  assert.equal(safeSerializedDemoState(oversized), undefined);

  restoreDemoState({ demoState: oversized });
  const recovered = getMockLuxartState();
  assert.equal(recovered.loggedIn, false);
  assert.equal(recovered.transactions.length, state.transactions.length);
});
