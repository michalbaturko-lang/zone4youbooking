import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repositoryRoot, "scripts", "check-launch-readiness.mjs");

function runLaunchCheck(
  phase: string,
  paymentMutationsEnabled: string,
  overrides: Record<string, string | undefined> = {},
) {
  const result = spawnSync(process.execPath, [script], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ZONE4YOU_DEPLOYMENT_PHASE: phase,
      PAYMENT_MUTATIONS_ENABLED: paymentMutationsEnabled,
      LUXART_WAITLIST_ENABLED: "false",
      ...overrides,
    },
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

test("launch gate treats Stripe as out of scope only for booking_without_payments", () => {
  const withoutPayments = runLaunchCheck("booking_without_payments", "false");
  assert.equal(withoutPayments.status, 1);
  assert.match(withoutPayments.output, /SKIP  Stripe credentials/);
  assert.match(withoutPayments.output, /SKIP  Payment product sign-off/);
  assert.match(withoutPayments.output, /SKIP  Durable payment ledger/);
  assert.match(withoutPayments.output, /PASS  Payment mutation release switch/);
  assert.match(withoutPayments.output, /PASS  Runtime readiness and region contract/);
  assert.match(withoutPayments.output, /PASS  Watchdog mutation release switch/);
  assert.match(withoutPayments.output, /SKIP  Luxart Stripe payment mapping/);
  assert.match(withoutPayments.output, /4 Stripe checks are explicitly not applicable/);

  const unsafeWithoutPayments = runLaunchCheck("booking_without_payments", "true");
  assert.equal(unsafeWithoutPayments.status, 1);
  assert.match(unsafeWithoutPayments.output, /FAIL  Payment mutation release switch/);

  const unsafeWatchdog = runLaunchCheck("booking_without_payments", "false", {
    LUXART_WAITLIST_ENABLED: "true",
  });
  assert.equal(unsafeWatchdog.status, 1);
  assert.match(unsafeWatchdog.output, /FAIL  Watchdog mutation release switch/);

  const malformedResourceMap = runLaunchCheck("booking_without_payments", "false", {
    LUXART_RESOURCE_MAP_JSON: JSON.stringify({ 1: 101, broken: 0 }),
  });
  assert.equal(malformedResourceMap.status, 1);
  assert.match(malformedResourceMap.output, /FAIL  Luxart reservation resources/);

  const ambiguousResourceMap = runLaunchCheck("booking_without_payments", "false", {
    LUXART_RESOURCE_MAP_JSON: JSON.stringify({ "01": 101 }),
  });
  assert.equal(ambiguousResourceMap.status, 1);
  assert.match(ambiguousResourceMap.output, /FAIL  Luxart reservation resources/);

  const withStripe = runLaunchCheck("booking_with_stripe", "false");
  assert.equal(withStripe.status, 1);
  assert.match(withStripe.output, /FAIL  Stripe credentials/);
  assert.match(withStripe.output, /FAIL  Payment product sign-off/);
  assert.match(withStripe.output, /FAIL  Durable payment ledger/);
  assert.match(withStripe.output, /FAIL  Payment mutation release switch/);
  assert.match(withStripe.output, /FAIL  Luxart Stripe payment mapping/);
  assert.doesNotMatch(withStripe.output, /SKIP  Stripe credentials/);

  const readOnly = runLaunchCheck("read_only", "false");
  assert.equal(readOnly.status, 1);
  assert.match(readOnly.output, /FAIL  Payment mutation release switch/);
  assert.doesNotMatch(readOnly.output, /SKIP  Stripe credentials/);
});

test("launch gate does not infer active Luxart email templates from provider ownership alone", () => {
  const ownershipOnly = runLaunchCheck("booking_without_payments", "false", {
    NOTIFICATION_PROVIDER: "luxart",
  });
  assert.equal(ownershipOnly.status, 1);
  assert.match(ownershipOnly.output, /FAIL  Notification ownership/);

  const confirmedTemplates = runLaunchCheck("booking_without_payments", "false", {
    NOTIFICATION_PROVIDER: "luxart",
    LUXART_NOTIFICATION_TEMPLATES_CONFIRMED: "true",
  });
  assert.equal(confirmedTemplates.status, 1);
  assert.match(confirmedTemplates.output, /PASS  Notification ownership/);
});
