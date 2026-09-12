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
  assert.equal(result.launchAuthority, false);
  assert.equal(result.credentialsAuthorized, false);
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

test("Luxart Help probe identifies a SOAP/WCF service without following exposed config links", async () => {
  const observed: Array<{ url: URL; init?: RequestInit }> = [];
  const result = await runLuxartHelpProbe({
    environment: {
      LUXART_HELP_URL: "http://api.memberzone.example:9191/Help",
      LUXART_EXPECTED_PORT: "9191",
      LUXART_ALLOW_INSECURE_TEST_HTTP: "true",
    },
    now: new Date("2026-09-12T16:00:00.000Z"),
    fetchImpl: async (url, init) => {
      observed.push({ url, init });
      if (url.pathname === "/Help") return new Response("Not found", { status: 404 });
      if (url.pathname === "/") {
        return new Response(
          '<html><title>api.memberzone.example - /</title><a href="/Web.config">Web.config</a></html>',
          { status: 200 },
        );
      }
      if (url.pathname === "/Service1.svc" && url.search === "?wsdl") {
        return new Response(
          '<wsdl:definitions><wsdl:operation name="SetReservation"/></wsdl:definitions>',
          { status: 200 },
        );
      }
      throw new Error(`Unexpected public diagnostic path: ${url.pathname}`);
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, "soap_wcf_not_rest");
  assert.equal(result.candidateContract, "soap_wcf");
  assert.equal(result.directoryBrowsingDetected, true);
  assert.equal(result.launchAuthority, false);
  assert.equal(result.credentialsAuthorized, false);
  assert.deepEqual(
    observed.map(({ url }) => `${url.pathname}${url.search}`).sort(),
    ["/", "/Help", "/Service1.svc?wsdl"],
  );
  for (const request of observed) {
    assert.equal(request.init?.method, "GET");
    assert.equal(request.init?.redirect, "manual");
    const headers = new Headers(request.init?.headers);
    assert.equal(headers.has("authorization"), false);
    assert.equal(headers.has("cookie"), false);
  }
  assert.equal(observed.some(({ url }) => /Web\.config|App_Data|\/bin\//i.test(url.href)), false);
  assert.equal(JSON.stringify(result).includes("api.memberzone.example"), false);
});

test("Luxart Help probe reports public directory listing as a non-REST security observation", async () => {
  const result = await runLuxartHelpProbe({
    environment: secureEnvironment,
    fetchImpl: async (url) => {
      if (url.pathname === "/Help") return new Response("Not found", { status: 404 });
      if (url.pathname === "/") {
        return new Response(
          '<html><title>luxart-zone4you.example.com - /</title><a href="/bin/">bin</a></html>',
          { status: 200 },
        );
      }
      return new Response("Not found", { status: 404 });
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.classification, "directory_listing_detected");
  assert.equal(result.candidateContract, "unknown");
  assert.equal(result.directoryBrowsingDetected, true);
  assert.equal(result.launchAuthority, false);
  assert.equal(result.credentialsAuthorized, false);
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
