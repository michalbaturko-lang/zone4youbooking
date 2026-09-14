import assert from "node:assert/strict";
import test from "node:test";
import {
  assertConfirmedLuxartGatewayAuth,
  loadLuxartGatewayAuthConfig,
} from "../src/lib/luxartGatewayAuth";
import { verifyLuxartGatewayConfiguration } from "../scripts/verify-luxart-gateway-config";

test("Luxart gateway auth defaults to no upstream authorization without inventing credentials", () => {
  assert.deepEqual(loadLuxartGatewayAuthConfig({}), { mode: "none", headers: {} });
});

test("Luxart gateway auth creates Basic authorization only from the dedicated server credentials", () => {
  const config = loadLuxartGatewayAuthConfig({
    LUXART_API_AUTH_MODE: "basic",
    LUXART_API_BASIC_USERNAME: "gateway-user",
    LUXART_API_BASIC_PASSWORD: "gateway-password",
  });
  assert.equal(config.mode, "basic");
  assert.equal(config.headers.Authorization, `Basic ${Buffer.from("gateway-user:gateway-password").toString("base64")}`);
});

test("Luxart gateway auth supports bearer and a constrained custom X header", () => {
  assert.deepEqual(loadLuxartGatewayAuthConfig({
    LUXART_API_AUTH_MODE: "bearer",
    LUXART_API_BEARER_TOKEN: "opaque-gateway-token",
  }), {
    mode: "bearer",
    headers: { Authorization: "Bearer opaque-gateway-token" },
  });
  assert.deepEqual(loadLuxartGatewayAuthConfig({
    LUXART_API_AUTH_MODE: "header",
    LUXART_API_AUTH_HEADER_NAME: "X-MemberPro-Key",
    LUXART_API_AUTH_HEADER_VALUE: "opaque-header-value",
  }), {
    mode: "header",
    headers: { "X-MemberPro-Key": "opaque-header-value" },
  });
});

test("Luxart gateway auth rejects ambiguous, injectable or unused secret configuration", () => {
  assert.throws(
    () => loadLuxartGatewayAuthConfig({ LUXART_API_AUTH_MODE: "basic", LUXART_API_BASIC_USERNAME: "user" }),
    /BASIC_PASSWORD is required/i,
  );
  assert.throws(
    () => loadLuxartGatewayAuthConfig({
      LUXART_API_AUTH_MODE: "bearer",
      LUXART_API_BEARER_TOKEN: "token\r\nX-Injected: yes",
    }),
    /control character/i,
  );
  assert.throws(
    () => loadLuxartGatewayAuthConfig({
      LUXART_API_AUTH_MODE: "none",
      LUXART_API_BEARER_TOKEN: "silently-unused",
    }),
    /Unused Luxart gateway auth variables/i,
  );
  assert.throws(
    () => loadLuxartGatewayAuthConfig({
      LUXART_API_AUTH_MODE: "header",
      LUXART_API_AUTH_HEADER_NAME: "Authorization",
      LUXART_API_AUTH_HEADER_VALUE: "custom-secret",
    }),
    /X- prefixed/i,
  );
});

test("Luxart gateway decision must be explicit before the launch verifier can pass", () => {
  assert.throws(
    () => assertConfirmedLuxartGatewayAuth({ LUXART_API_AUTH_MODE: "none" }),
    /AUTH_CONFIRMED must be true/i,
  );
  const result = verifyLuxartGatewayConfiguration({
    LUXART_API_AUTH_MODE: "none",
    LUXART_API_AUTH_CONFIRMED: "true",
  });
  assert.equal(result.ok, true);
  assert.match(result.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.gatewayAuthMode, "none");
  assert.equal(result.authorizationHeaderConfigured, false);
  assert.equal(result.gatewayDecisionConfirmed, true);
});
