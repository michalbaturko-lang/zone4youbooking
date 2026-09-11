import assert from "node:assert/strict";
import test from "node:test";
import {
  assertExternalDemoReadiness,
  externalDemoOrigin,
  verifyExternalDemoTarget,
} from "../e2e/external-demo-guard";

const previewUrl = "https://zone4youbooking-safe123-mbos-projects-220653ae.vercel.app";
const readyDemo = {
  status: "ready",
  mode: "demo",
  phase: "demo",
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

test("external browser regression requires the complete demo/mock capability profile", () => {
  assert.doesNotThrow(() => assertExternalDemoReadiness(readyDemo));
  for (const drift of [
    { ...readyDemo, mode: "live" },
    { ...readyDemo, luxart: "ready" },
    { ...readyDemo, capabilities: { ...readyDemo.capabilities, topupMode: "stripe" } },
    { ...readyDemo, capabilities: { ...readyDemo.capabilities, forgotPasswordEnabled: true } },
  ]) {
    assert.throws(() => assertExternalDemoReadiness(drift), /refused/i);
  }
});

test("external guard performs only one unauthenticated readiness GET", async () => {
  let requestCount = 0;
  let observedUrl = "";
  let observedInit: RequestInit | undefined;
  await verifyExternalDemoTarget(
    { PLAYWRIGHT_EXTERNAL_DEMO_URL: `${previewUrl}/` },
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
