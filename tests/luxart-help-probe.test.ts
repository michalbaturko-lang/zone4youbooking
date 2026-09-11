import assert from "node:assert/strict";
import test from "node:test";
import {
  loadLuxartHelpProbeConfiguration,
  runLuxartHelpProbe,
} from "../scripts/probe-luxart-help";

const secureEnvironment = {
  LUXART_HELP_URL: "https://luxart-zone4you.example.com:9191/Help",
  LUXART_EXPECTED_PORT: "9191",
};

test("Luxart Help probe requires one clean, explicitly secured endpoint", () => {
  assert.throws(() => loadLuxartHelpProbeConfiguration({}), /HELP_URL or LUXART_API_BASE_URL/i);
  assert.throws(
    () => loadLuxartHelpProbeConfiguration({ LUXART_HELP_URL: "https://user:secret@example.com/Help" }),
    /must not contain credentials/i,
  );
  assert.throws(
    () => loadLuxartHelpProbeConfiguration({ LUXART_HELP_URL: "http://example.com:9191/Help" }),
    /requires HTTPS/i,
  );
  assert.throws(
    () => loadLuxartHelpProbeConfiguration({ ...secureEnvironment, LUXART_EXPECTED_PORT: "9759" }),
    /does not use LUXART_EXPECTED_PORT/i,
  );
});

test("Luxart Help probe derives /Help from the API base without credentials", () => {
  const configuration = loadLuxartHelpProbeConfiguration({
    LUXART_API_BASE_URL: "https://luxart-zone4you.example.com:9191/api/",
    LUXART_EXPECTED_PORT: "9191",
  });
  assert.equal(configuration.helpUrl.href, "https://luxart-zone4you.example.com:9191/Help");
  assert.equal(configuration.transport, "https");
  assert.equal(configuration.port, "9191");
  assert.match(configuration.targetFingerprintSha256, /^[a-f0-9]{64}$/);
});

test("Luxart Help probe sends no authentication data and recognizes the documentation", async () => {
  let observedUrl = "";
  let observedInit: RequestInit | undefined;
  const result = await runLuxartHelpProbe({
    environment: secureEnvironment,
    now: new Date("2026-09-11T12:00:00.000Z"),
    fetchImpl: async (url, init) => {
      observedUrl = url.href;
      observedInit = init;
      return new Response("<html><title>API dokumentace</title></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, "ready");
  assert.equal(observedUrl, secureEnvironment.LUXART_HELP_URL);
  assert.equal(observedInit?.method, "GET");
  assert.equal(observedInit?.redirect, "manual");
  const headers = new Headers(observedInit?.headers);
  assert.equal(headers.has("authorization"), false);
  assert.equal(headers.has("cookie"), false);
  assert.equal(JSON.stringify(result).includes("luxart-zone4you.example.com"), false);
});

test("Luxart Help probe distinguishes auth, redirects and non-document responses", async () => {
  for (const [status, expected] of [[401, "authentication_required"], [302, "redirect_rejected"]] as const) {
    const result = await runLuxartHelpProbe({
      environment: secureEnvironment,
      fetchImpl: async () => new Response("", { status }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reached, true);
    assert.equal(result.classification, expected);
  }

  const unexpected = await runLuxartHelpProbe({
    environment: secureEnvironment,
    fetchImpl: async () => new Response("<html><title>Unrelated service</title></html>", { status: 200 }),
  });
  assert.equal(unexpected.ok, false);
  assert.equal(unexpected.classification, "unexpected_response");
});

test("Luxart Help probe reports network failure without echoing the endpoint", async () => {
  const result = await runLuxartHelpProbe({
    environment: secureEnvironment,
    fetchImpl: async () => {
      const error = new TypeError("connect to luxart-zone4you.example.com failed") as TypeError & { cause: { code: string } };
      error.cause = { code: "ETIMEDOUT" };
      throw error;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reached, false);
  assert.equal(result.classification, "network_unavailable");
  assert.equal(result.networkCode, "ETIMEDOUT");
  assert.equal(JSON.stringify(result).includes("luxart-zone4you.example.com"), false);
});
