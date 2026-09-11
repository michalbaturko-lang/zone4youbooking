import assert from "node:assert/strict";
import test from "node:test";
import {
  assertExternalDemoReadiness,
  externalDemoExpectedCommit,
  externalDemoOrigin,
  externalDemoRequestHeaders,
  isExpectedExternalDemoConsoleNoise,
  verifyExternalDemoTarget,
} from "../e2e/external-demo-guard";

const previewUrl = "https://zone4youbooking-safe123-mbos-projects-220653ae.vercel.app";
const previewCommit = "1234567890abcdef1234567890abcdef12345678";
const readyDemo = {
  status: "ready",
  mode: "demo",
  phase: "demo",
  commit: previewCommit,
  region: "fra1",
  luxart: "mock",
  schedule: "mock",
  capabilities: {
    reservationsEnabled: true,
    topupMode: "demo",
    forgotPasswordEnabled: false,
    englishEnabled: true,
  },
};

test("external browser regression accepts only isolated Zone4You HTTPS previews", () => {
  assert.equal(externalDemoOrigin({}), undefined);
  assert.equal(externalDemoOrigin({ PLAYWRIGHT_EXTERNAL_DEMO_URL: `${previewUrl}/` }), previewUrl);
  for (const unsafe of [
    "http://zone4youbooking-safe123-mbos-projects-220653ae.vercel.app/",
    "https://booking.zone4you.cz/",
    "https://zone4youbooking.vercel.app/",
    "https://zone4youbooking-safe123-mbos-projects-220653ae.vercel.app/other",
    "https://unrelated-project-mbos-projects-220653ae.vercel.app/",
  ]) {
    assert.throws(() => externalDemoOrigin({ PLAYWRIGHT_EXTERNAL_DEMO_URL: unsafe }), /root HTTPS|restricted/i);
  }
});

test("external browser regression disables only the Vercel Preview toolbar", () => {
  assert.deepEqual(externalDemoRequestHeaders({}), {});
  assert.deepEqual(
    externalDemoRequestHeaders({ PLAYWRIGHT_EXTERNAL_DEMO_URL: `${previewUrl}/` }),
    { "x-vercel-skip-toolbar": "1" },
  );
});

test("external browser regression requires an exact expected Preview commit", () => {
  assert.equal(externalDemoExpectedCommit({}), undefined);
  assert.equal(
    externalDemoExpectedCommit({
      PLAYWRIGHT_EXTERNAL_DEMO_URL: `${previewUrl}/`,
      PLAYWRIGHT_EXPECTED_DEMO_COMMIT: previewCommit.toUpperCase(),
    }),
    previewCommit,
  );
  for (const value of [undefined, "abc", "g".repeat(40)]) {
    assert.throws(
      () => externalDemoExpectedCommit({
        PLAYWRIGHT_EXTERNAL_DEMO_URL: `${previewUrl}/`,
        PLAYWRIGHT_EXPECTED_DEMO_COMMIT: value,
      }),
      /exact 40-character Git commit/i,
    );
  }
});

test("external browser regression ignores only Vercel toolbar CSP noise", () => {
  const toolbarCspError = "Loading the script 'https://vercel.live/_next-live/feedback/feedback.js' violates the following Content Security Policy directive: script-src. The action has been blocked.";
  const previewEnvironment = { PLAYWRIGHT_EXTERNAL_DEMO_URL: `${previewUrl}/` };

  assert.equal(isExpectedExternalDemoConsoleNoise(toolbarCspError, previewEnvironment), true);
  assert.equal(isExpectedExternalDemoConsoleNoise(toolbarCspError, {}), false);
  assert.equal(isExpectedExternalDemoConsoleNoise("Application failed to load.", previewEnvironment), false);
  assert.equal(
    isExpectedExternalDemoConsoleNoise(
      "Loading the script 'https://example.com/feedback.js' violates the following Content Security Policy directive: script-src. The action has been blocked.",
      previewEnvironment,
    ),
    false,
  );
});

test("external browser regression requires the complete demo/mock capability profile", () => {
  assert.doesNotThrow(() => assertExternalDemoReadiness(readyDemo, previewCommit));
  for (const drift of [
    { ...readyDemo, mode: "live" },
    { ...readyDemo, commit: "a".repeat(40) },
    { ...readyDemo, region: "iad1" },
    { ...readyDemo, luxart: "ready" },
    { ...readyDemo, capabilities: { ...readyDemo.capabilities, topupMode: "stripe" } },
    { ...readyDemo, capabilities: { ...readyDemo.capabilities, forgotPasswordEnabled: true } },
  ]) {
    assert.throws(() => assertExternalDemoReadiness(drift, previewCommit), /refused/i);
  }
});

test("external guard performs only one unauthenticated readiness GET", async () => {
  let requestCount = 0;
  let observedUrl = "";
  let observedInit: RequestInit | undefined;
  await verifyExternalDemoTarget(
    {
      PLAYWRIGHT_EXTERNAL_DEMO_URL: `${previewUrl}/`,
      PLAYWRIGHT_EXPECTED_DEMO_COMMIT: previewCommit,
    },
    async (input, init) => {
      requestCount += 1;
      observedUrl = input.toString();
      observedInit = init;
      return Response.json(readyDemo);
    },
  );
  assert.equal(requestCount, 1);
  assert.equal(observedUrl, `${previewUrl}/api/readiness`);
  assert.equal(observedInit?.method, "GET");
  assert.equal(observedInit?.redirect, "error");
  const headers = new Headers(observedInit?.headers);
  assert.equal(headers.has("authorization"), false);
  assert.equal(headers.has("cookie"), false);
});
