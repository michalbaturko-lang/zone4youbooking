import assert from "node:assert/strict";
import test from "node:test";
import {
  alertTargetFingerprint,
  loadAlertDeliveryConfig,
  runAlertDeliveryTest,
} from "../scripts/verify-alert-delivery";
import { validateAlertEvidence } from "../scripts/verify-pilot-release";

const webhook = new URL("https://hooks.example.com/services/private-path-token");
const baseEnvironment = {
  ZONE4YOU_ALERT_APP_URL: "https://staging.booking.zone4you.cz/",
  ZONE4YOU_ALERT_WEBHOOK_URL: webhook.toString(),
  ZONE4YOU_ALERT_SUPPORT_OWNER: "Zone4You reception",
  ZONE4YOU_ALERT_CONFIRMATION: `SEND_ZONE4YOU_TEST_ALERT:${alertTargetFingerprint(webhook)}`,
} satisfies Record<string, string | undefined>;

test("alert test configuration requires HTTPS, an owner and exact target fingerprint", () => {
  assert.throws(
    () => loadAlertDeliveryConfig({ ...baseEnvironment, ZONE4YOU_ALERT_CONFIRMATION: "SEND" }),
    /exactly equal/i,
  );
  assert.throws(
    () => loadAlertDeliveryConfig({
      ...baseEnvironment,
      ZONE4YOU_ALERT_WEBHOOK_URL: "http://hooks.example.com/test",
    }),
    /HTTPS/i,
  );
  assert.throws(
    () => loadAlertDeliveryConfig({ ...baseEnvironment, ZONE4YOU_ALERT_SUPPORT_OWNER: "" }),
    /required/i,
  );
  for (const placeholder of ["TBD", "unknown", "N/A", "pending-human-approval"]) {
    assert.throws(
      () => loadAlertDeliveryConfig({ ...baseEnvironment, ZONE4YOU_ALERT_SUPPORT_OWNER: placeholder }),
      /actual support person or operational role/i,
    );
  }
  assert.throws(
    () => loadAlertDeliveryConfig({ ...baseEnvironment, ZONE4YOU_ALERT_SUPPORT_OWNER: "Reception\u0000desk" }),
    /control characters/i,
  );
});

test("alert delivery emits a privacy-safe test event and evidence without webhook secrets", async () => {
  const config = loadAlertDeliveryConfig({ ...baseEnvironment, ZONE4YOU_ALERT_BEARER_TOKEN: "bearer-secret" });
  let receivedBody: Record<string, unknown> | undefined;
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    assert.equal(url.toString(), webhook.toString());
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer bearer-secret");
    receivedBody = JSON.parse(String(init?.body));
    return new Response("accepted", { status: 202 });
  };

  const evidence = await runAlertDeliveryTest(config, fakeFetch);
  validateAlertEvidence(evidence, config.appTarget.origin);
  assert.equal(evidence.ok, true);
  assert.equal(evidence.responseStatus, 202);
  assert.equal(evidence.manualReceiptConfirmationRequired, true);
  assert.equal(receivedBody?.event, "zone4you.pilot.test_alert");
  assert.equal(receivedBody?.severity, "test");
  assert.equal(JSON.stringify(evidence).includes("private-path-token"), false);
  assert.equal(JSON.stringify(evidence).includes("bearer-secret"), false);
  assert.equal(JSON.stringify(receivedBody).includes("bearer-secret"), false);
});

test("alert delivery fails when the target does not accept the event", async () => {
  const config = loadAlertDeliveryConfig(baseEnvironment);
  await assert.rejects(
    runAlertDeliveryTest(config, async () => new Response("rejected", { status: 503 })),
    /HTTP 503/i,
  );
});
