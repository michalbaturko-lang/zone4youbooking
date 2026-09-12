import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const realAdapterPath = join(repositoryRoot, "src/lib/realLuxartAdapter.ts");
const realAdapter = readFileSync(realAdapterPath, "utf8");
const stripeWebhookPath = join(repositoryRoot, "src/app/api/payments/webhook/route.ts");
const stripeCheckoutPath = join(repositoryRoot, "src/app/api/payments/checkout/route.ts");
const paymentProcessorPath = join(repositoryRoot, "src/lib/paymentProcessor.ts");
const paymentLedgerPath = join(repositoryRoot, "src/lib/paymentLedger.ts");
const paymentMigrationPath = join(repositoryRoot, "migrations/001_payment_ledger.sql");
const bookingLedgerPath = join(repositoryRoot, "src/lib/bookingMutationLedger.ts");
const bookingProcessorPath = join(repositoryRoot, "src/lib/bookingMutationProcessor.ts");
const bookingMigrationPath = join(repositoryRoot, "migrations/002_booking_mutation_ledger.sql");
const rateLimitPath = join(repositoryRoot, "src/lib/rateLimit.ts");
const rateLimitMigrationPath = join(repositoryRoot, "migrations/003_rate_limit.sql");
const readinessRoutePath = join(repositoryRoot, "src/app/api/readiness/route.ts");
const vercelConfigPath = join(repositoryRoot, "vercel.json");
const packageConfigPath = join(repositoryRoot, "package.json");
const businessRulesProfilePath = join(repositoryRoot, "config/business-rules-profile.json");
const paymentProductProfilePath = join(repositoryRoot, "config/payment-product-profile.json");
const bookingRulesImplementationPath = join(repositoryRoot, "config/booking-rules-implementation.json");
const stripeWebhook = existsSync(stripeWebhookPath) ? readFileSync(stripeWebhookPath, "utf8") : "";
const stripeCheckout = existsSync(stripeCheckoutPath) ? readFileSync(stripeCheckoutPath, "utf8") : "";
const paymentProcessor = existsSync(paymentProcessorPath) ? readFileSync(paymentProcessorPath, "utf8") : "";
const paymentLedger = existsSync(paymentLedgerPath) ? readFileSync(paymentLedgerPath, "utf8") : "";
const paymentMigration = existsSync(paymentMigrationPath) ? readFileSync(paymentMigrationPath, "utf8") : "";
const bookingLedger = existsSync(bookingLedgerPath) ? readFileSync(bookingLedgerPath, "utf8") : "";
const bookingProcessor = existsSync(bookingProcessorPath) ? readFileSync(bookingProcessorPath, "utf8") : "";
const bookingMigration = existsSync(bookingMigrationPath) ? readFileSync(bookingMigrationPath, "utf8") : "";
const rateLimit = existsSync(rateLimitPath) ? readFileSync(rateLimitPath, "utf8") : "";
const rateLimitMigration = existsSync(rateLimitMigrationPath) ? readFileSync(rateLimitMigrationPath, "utf8") : "";
const businessRulesProfile = existsSync(businessRulesProfilePath)
  ? JSON.parse(readFileSync(businessRulesProfilePath, "utf8"))
  : {};
const bookingRulesImplementation = existsSync(bookingRulesImplementationPath)
  ? JSON.parse(readFileSync(bookingRulesImplementationPath, "utf8"))
  : {};
const paymentProductProfile = existsSync(paymentProductProfilePath)
  ? JSON.parse(readFileSync(paymentProductProfilePath, "utf8"))
  : {};
const vercelConfig = existsSync(vercelConfigPath)
  ? JSON.parse(readFileSync(vercelConfigPath, "utf8"))
  : {};
const packageConfig = existsSync(packageConfigPath)
  ? JSON.parse(readFileSync(packageConfigPath, "utf8"))
  : {};
const businessRulesProfileSha256 = createHash("sha256")
  .update(JSON.stringify(businessRulesProfile), "utf8")
  .digest("hex");
const paymentProductProfileSha256 = createHash("sha256")
  .update(JSON.stringify(paymentProductProfile), "utf8")
  .digest("hex");
const deploymentPhase = process.env.ZONE4YOU_DEPLOYMENT_PHASE;
const paymentsExcludedFromLaunch = deploymentPhase === "booking_without_payments";
const paymentsIncludedInLaunch = deploymentPhase === "booking_with_stripe";
const placeholderOperationalOwners = new Set([
  "-",
  "doplnit",
  "n a",
  "na",
  "none",
  "not assigned",
  "pending",
  "pending approval",
  "pending human approval",
  "placeholder",
  "tbd",
  "to be confirmed",
  "to be decided",
  "todo",
  "unassigned",
  "unknown",
]);

const checks = [];

function check(name, passed, detail, options = {}) {
  checks.push({
    name,
    passed: Boolean(passed),
    detail,
    applicable: options.applicable !== false,
  });
}

function configured(name) {
  return typeof process.env[name] === "string" && process.env[name].trim().length > 0;
}

function validOperationalOwner(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120 || /\p{Cc}/u.test(trimmed)) return false;
  const normalized = trimmed
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[_./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return !placeholderOperationalOwners.has(normalized) && !normalized.startsWith("replace with ");
}

function validHttpsUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname) &&
      !url.hostname.endsWith(".invalid")
    );
  } catch {
    return false;
  }
}

function validProductionAppUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.origin === "https://booking.zone4you.cz" &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function validPositiveIntegerMapping(value) {
  try {
    const mapping = JSON.parse(value);
    if (typeof mapping !== "object" || mapping === null || Array.isArray(mapping)) return false;
    const entries = Object.entries(mapping);
    return entries.length > 0 && entries.length <= 256 && entries.every(([room, resource]) =>
      /^\d+$/.test(room) &&
      Number.isSafeInteger(Number(room)) &&
      Number(room) > 0 &&
      String(Number(room)) === room &&
      Number.isSafeInteger(Number(resource)) &&
      Number(resource) > 0
    );
  } catch {
    return false;
  }
}

function validTlsPostgresUrl(value) {
  try {
    const url = new URL(value);
    return (
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      Boolean(url.hostname) &&
      !url.hostname.endsWith(".invalid") &&
      ["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode"))
    );
  } catch {
    return false;
  }
}

const requiredOperationsChain = [
  ["probe:runtime", "node scripts/probe-runtime.mjs", "scripts/probe-runtime.mjs"],
  ["verify:luxart-d1", "tsx scripts/verify-luxart-d1.ts", "scripts/verify-luxart-d1.ts"],
  ["verify:booking-mutations", "tsx scripts/verify-booking-mutations.ts", "scripts/verify-booking-mutations.ts"],
  ["start:readonly-rollback", "tsx scripts/start-readonly-rollback.ts", "scripts/start-readonly-rollback.ts"],
  ["verify:readonly-rollback", "tsx scripts/verify-readonly-rollback.ts", "scripts/verify-readonly-rollback.ts"],
  ["capture:production-domain-baseline", "tsx scripts/capture-production-domain-baseline.ts", "scripts/capture-production-domain-baseline.ts"],
  ["verify:production-domain-baseline", "tsx scripts/verify-production-domain-baseline.ts", "scripts/verify-production-domain-baseline.ts"],
  ["verify:alert-delivery", "tsx scripts/verify-alert-delivery.ts", "scripts/verify-alert-delivery.ts"],
  ["verify:memberzone-fallback", "tsx scripts/verify-memberzone-fallback.ts", "scripts/verify-memberzone-fallback.ts"],
  ["prepare:pilot-release", "tsx scripts/prepare-pilot-release-dossier.ts", "scripts/prepare-pilot-release-dossier.ts"],
  ["verify:pilot-release", "tsx scripts/verify-pilot-release.ts", "scripts/verify-pilot-release.ts"],
  ["verify:production-precutover", "tsx scripts/verify-production-precutover.ts", "scripts/verify-production-precutover.ts"],
  ["verify:production-cutover", "tsx scripts/verify-production-cutover.ts", "scripts/verify-production-cutover.ts"],
];

function operationsChainReady() {
  const scripts = packageConfig.scripts;
  return (
    typeof scripts === "object" &&
    scripts !== null &&
    requiredOperationsChain.every(([name, command, file]) =>
      scripts[name] === command && existsSync(join(repositoryRoot, file)))
  );
}

function verifiedPilotReleaseDossier() {
  if (
    !configured("ZONE4YOU_RELEASE_DOSSIER_PATH") ||
    !configured("ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION") ||
    !configured("ZONE4YOU_RELEASE_COMMIT")
  ) {
    return false;
  }
  try {
    execFileSync(
      join(repositoryRoot, "node_modules", ".bin", "tsx"),
      [join(repositoryRoot, "scripts", "verify-pilot-release.ts")],
      {
        cwd: repositoryRoot,
        env: process.env,
        stdio: "pipe",
        timeout: 5_000,
      },
    );
    return true;
  } catch {
    return false;
  }
}

function verifiedDeploymentPreflight() {
  try {
    execFileSync(
      join(repositoryRoot, "node_modules", ".bin", "tsx"),
      [join(repositoryRoot, "scripts", "verify-deployment-preflight.ts"), "--operator-context"],
      {
        cwd: repositoryRoot,
        env: process.env,
        stdio: "pipe",
        timeout: 5_000,
      },
    );
    return true;
  } catch {
    return false;
  }
}

function verifiedLuxartGatewayConfiguration() {
  if (!configured("LUXART_API_AUTH_MODE") || process.env.LUXART_API_AUTH_CONFIRMED !== "true") {
    return false;
  }
  try {
    execFileSync(
      join(repositoryRoot, "node_modules", ".bin", "tsx"),
      [join(repositoryRoot, "scripts", "verify-luxart-gateway-config.ts")],
      {
        cwd: repositoryRoot,
        env: process.env,
        stdio: "pipe",
        timeout: 5_000,
      },
    );
    return true;
  } catch {
    return false;
  }
}

function businessRulesProfileMatchesImplementation() {
  const cancellation = businessRulesProfile.groupCancellation;
  const reservationWindow = businessRulesProfile.reservationWindow;
  return (
    businessRulesProfile.status === "confirmed" &&
    typeof businessRulesProfile.profileId === "string" &&
    businessRulesProfile.profileId.trim().length > 0 &&
    businessRulesProfile.minimumCreditForReservationKc === bookingRulesImplementation.minimumCreditForReservationKc &&
    businessRulesProfile.reservationHoldKc === bookingRulesImplementation.reservationHoldKc &&
    reservationWindow?.mode === "rolling_hours" &&
    reservationWindow.hours === bookingRulesImplementation.reservationWindowHours &&
    cancellation?.freeCancellationCutoff?.mode === bookingRulesImplementation.freeCancellationCutoff.mode &&
    cancellation.freeCancellationCutoff.timeZone === bookingRulesImplementation.freeCancellationCutoff.timeZone &&
    cancellation.lateFeeKc === bookingRulesImplementation.lateCancelFeeKc &&
    cancellation.noShowFeeKc === bookingRulesImplementation.noShowFeeKc &&
    cancellation.lateCancellationAllowed === true &&
    businessRulesProfile.reformerCancellation?.mode === "same_as_group"
  );
}

function paymentProductProfileMatchesImplementation() {
  const amounts = paymentProductProfile.allowedTopupAmountsKc;
  const implemented = bookingRulesImplementation.topupAmounts;
  return (
    paymentProductProfile.status === "confirmed" &&
    paymentProductProfile.currency === "CZK" &&
    typeof paymentProductProfile.profileId === "string" &&
    paymentProductProfile.profileId.trim().length > 0 &&
    Array.isArray(paymentProductProfile.decisionSources) &&
    paymentProductProfile.decisionSources.length > 0 &&
    Array.isArray(amounts) &&
    Array.isArray(implemented) &&
    amounts.length === implemented.length &&
    amounts.every((amount, index) => Number.isSafeInteger(amount) && amount > 0 && amount === implemented[index])
  );
}

check(
  "Luxart live mode",
  process.env.LUXART_MOCK === "false",
  "LUXART_MOCK must be explicitly set to false for production.",
);
check(
  "Luxart HTTPS endpoint",
  configured("LUXART_API_BASE_URL") && validHttpsUrl(process.env.LUXART_API_BASE_URL),
  "LUXART_API_BASE_URL must point to the approved HTTPS Luxart endpoint.",
);
check(
  "Luxart REST contract and endpoint mapping",
  process.env.LUXART_API_CONTRACT === "memberzone_rest_v1" && !realAdapter.includes("notMapped("),
  "LUXART_API_CONTRACT must select the implemented Memberzone REST contract and RealLuxartAdapter must contain no unmapped production operations.",
);
check(
  "Luxart gateway authentication",
  verifiedLuxartGatewayConfiguration(),
  "IT must explicitly confirm none/basic/bearer/custom-header gateway auth; configure it only in the secret store and run npm run verify:luxart-gateway-config.",
);
check(
  "Luxart reservation resources",
  configured("LUXART_RESOURCE_MAP_JSON") && validPositiveIntegerMapping(process.env.LUXART_RESOURCE_MAP_JSON),
  "LUXART_RESOURCE_MAP_JSON must map Zone4You room numbers to positive Luxart id_resource values.",
);
check(
  "Production application URL",
  configured("APP_BASE_URL") && validProductionAppUrl(process.env.APP_BASE_URL),
  "APP_BASE_URL must be exactly https://booking.zone4you.cz/ for production.",
);
check(
  "Deployment preflight",
  verifiedDeploymentPreflight(),
  "The exact production commit, phase, origins, capability switches and runtime-only secrets must pass npm run verify:deployment-preflight without exposing secret values.",
);
check(
  "Server session secret",
  configured("SESSION_SECRET") && process.env.SESSION_SECRET.length >= 32,
  "SESSION_SECRET must contain at least 32 characters and must never be exposed to the browser.",
);
check(
  "Production read and mutation rate limiting",
  (
    process.env.RATE_LIMIT_MODE === "memory" &&
    process.env.RATE_LIMIT_SINGLE_INSTANCE === "true"
  ) || (
    process.env.RATE_LIMIT_MODE === "postgres" &&
    configured("RATE_LIMIT_DATABASE_URL") &&
    validTlsPostgresUrl(process.env.RATE_LIMIT_DATABASE_URL) &&
    rateLimit.includes("ON CONFLICT (bucket_key) DO UPDATE") &&
    rateLimitMigration.includes("zone4you_rate_limit_schema") &&
    rateLimitMigration.includes("VALUES (1)") &&
    rateLimitMigration.includes("bucket_key text PRIMARY KEY")
  ),
  "Protect schedule, account reads, login and mutations with the PostgreSQL limiter from migrations/003_rate_limit.sql and a pooled TLS RATE_LIMIT_DATABASE_URL, or explicitly confirm a true single-instance pilot.",
);
check(
  "Booking mutation release switch",
  process.env.BOOKING_MUTATIONS_ENABLED === "true",
  "BOOKING_MUTATIONS_ENABLED must be explicitly enabled only for an approved transactional pilot; false is the read-only rollback state.",
);
check(
  "Watchdog mutation release switch",
  process.env.LUXART_WAITLIST_ENABLED === "false",
  "The limited pilot requires LUXART_WAITLIST_ENABLED=false until watchdog create/delete and Luxart notification delivery pass live E4 evidence.",
);
check(
  "Business rules sign-off",
  process.env.BOOKING_RULES_CONFIRMED === "true" &&
    businessRulesProfileMatchesImplementation() &&
    process.env.BOOKING_RULES_PROFILE_SHA256 === businessRulesProfileSha256,
  "The checked-in rule profile must be confirmed, match the implementation and have its exact npm run inspect:business-rules SHA-256 approved in BOOKING_RULES_PROFILE_SHA256.",
);
check(
  "Durable booking mutation ledger",
  process.env.BOOKING_LEDGER_MODE === "postgres" &&
    configured("BOOKING_DATABASE_URL") &&
    validTlsPostgresUrl(process.env.BOOKING_DATABASE_URL) &&
    bookingLedger.includes("pg_try_advisory_lock") &&
    bookingLedger.includes("ORPHANED_PROCESSING") &&
    bookingProcessor.includes("BOOKING_RECONCILIATION_REQUIRED") &&
    bookingMigration.includes("zone4you_booking_mutation_schema") &&
    bookingMigration.includes("VALUES (1)") &&
    bookingMigration.includes("UNIQUE (user_id, idempotency_key)"),
  "Apply the booking mutation migration and configure a TLS BOOKING_DATABASE_URL before enabling live reservation writes.",
);
check(
  "Stripe credentials",
  configured("STRIPE_SECRET_KEY") &&
    process.env.STRIPE_SECRET_KEY.length >= 16 &&
    configured("STRIPE_WEBHOOK_SECRET") &&
    process.env.STRIPE_WEBHOOK_SECRET.startsWith("whsec_") &&
    process.env.STRIPE_WEBHOOK_SECRET.length >= 16 &&
    ["true", "false"].includes(process.env.STRIPE_LIVEMODE) &&
    (process.env.STRIPE_LIVEMODE === "true"
      ? process.env.STRIPE_SECRET_KEY.startsWith("sk_live_")
      : process.env.STRIPE_SECRET_KEY.startsWith("sk_test_")),
  "Stripe secret, webhook secret and an explicit matching live/test mode are required.",
  { applicable: !paymentsExcludedFromLaunch },
);
check(
  "Payment product sign-off",
  process.env.PAYMENT_PRODUCT_CONFIRMED === "true" &&
    paymentProductProfileMatchesImplementation() &&
    process.env.PAYMENT_PRODUCT_PROFILE_SHA256 === paymentProductProfileSha256,
  "The confirmed CZK top-up amounts must match implementation and the exact npm run inspect:payment-product SHA-256 must be approved.",
  { applicable: !paymentsExcludedFromLaunch },
);
check(
  "Stripe Checkout endpoint",
  stripeCheckout.includes("checkout.sessions.create") &&
    stripeCheckout.includes("readBookingSession") &&
    stripeCheckout.includes("assertReady") &&
    stripeCheckout.includes("approvedStripeCheckoutUrl"),
  "Checkout must be created server-side for the authenticated client only after the durable ledger is reachable.",
);
check(
  "Stripe webhook verification and processing",
  stripeWebhook.includes("request.text()") &&
    stripeWebhook.includes("constructEvent") &&
    stripeWebhook.includes("processStripeTopupEvent") &&
    paymentProcessor.includes("retrieveSession") &&
    paymentProcessor.includes("applyVerifiedStripeTopup"),
  "The webhook must verify the raw Stripe signature and pass a validated paid session to the idempotent top-up processor.",
);
check(
  "Durable payment ledger",
  process.env.PAYMENT_LEDGER_MODE === "postgres" &&
    configured("PAYMENT_DATABASE_URL") &&
    validTlsPostgresUrl(process.env.PAYMENT_DATABASE_URL) &&
    paymentLedger.includes("BEGIN") &&
    paymentLedger.includes("ON CONFLICT DO NOTHING") &&
    paymentMigration.includes("zone4you_payment_schema") &&
    paymentMigration.includes("VALUES (1)") &&
    paymentMigration.includes("stripe_checkout_session_id text NOT NULL UNIQUE"),
  "Apply the PostgreSQL payment migration and configure a TLS PAYMENT_DATABASE_URL for the atomic event/session ledger.",
  { applicable: !paymentsExcludedFromLaunch },
);
check(
  "Payment mutation release switch",
  (paymentsIncludedInLaunch && process.env.PAYMENT_MUTATIONS_ENABLED === "true") ||
    (paymentsExcludedFromLaunch && process.env.PAYMENT_MUTATIONS_ENABLED === "false"),
  "PAYMENT_MUTATIONS_ENABLED must be true only for booking_with_stripe and false for booking_without_payments; any other phase is invalid for transactional launch.",
);
check(
  "Luxart Stripe payment mapping",
  process.env.LUXART_PAYMENT_MAPPING_CONFIRMED === "true" &&
    Number.isInteger(Number(process.env.LUXART_STRIPE_PAYMENT_METHOD_ID)) &&
    Number(process.env.LUXART_STRIPE_PAYMENT_METHOD_ID) > 0,
  "Luxart must confirm the Stripe zpusob_uhrady value and deduplication behavior for Stripe Checkout session IDs.",
  { applicable: !paymentsExcludedFromLaunch },
);
check(
  "Notification ownership",
  process.env.NOTIFICATION_PROVIDER === "luxart" &&
    process.env.LUXART_NOTIFICATION_TEMPLATES_CONFIRMED === "true",
  "Luxart must own standard booking emails and explicitly confirm the Zone4You templates are enabled.",
);
check(
  "English localization",
  existsSync(join(repositoryRoot, "src/messages/en.json")) &&
    existsSync(join(repositoryRoot, "src/messages/cs.json")) &&
    existsSync(join(repositoryRoot, "src/lib/i18n.ts")),
  "Both Czech and English message catalogs and the runtime locale layer are required.",
);
check(
  "Desktop/mobile browser evaluation",
  existsSync(join(repositoryRoot, "playwright.config.ts")) &&
    existsSync(join(repositoryRoot, "e2e/pilot.spec.ts")),
  "Playwright pilot tests for the required desktop and mobile viewports are required.",
);
check(
  "Runtime readiness and region contract",
  existsSync(readinessRoutePath) &&
    vercelConfig.framework === "nextjs" &&
    Array.isArray(vercelConfig.regions) &&
    vercelConfig.regions.length === 1 &&
    vercelConfig.regions[0] === "fra1",
  "The production readiness endpoint and an exact Vercel fra1 Next.js runtime contract are required.",
);
check(
  "Pilot alert delivery",
  existsSync(join(repositoryRoot, "scripts/verify-alert-delivery.ts")) &&
    process.env.ZONE4YOU_ALERT_DELIVERY_CONFIRMED === "true" &&
    validOperationalOwner(process.env.ZONE4YOU_ALERT_SUPPORT_OWNER),
  "Run the privacy-safe test alert, have the named support owner confirm receipt and set ZONE4YOU_ALERT_DELIVERY_CONFIRMED=true.",
);
check(
  "Operations and UAT artifacts",
  existsSync(join(repositoryRoot, "docs/operations-runbook.md")) &&
    existsSync(join(repositoryRoot, "docs/pilot-uat-checklist.md")) &&
    operationsChainReady(),
  "The runbook, UAT checklist and exact npm command chain for live D1, runtime, mutation UAT, immutable rollback, DNS baseline, alert, Memberzone fallback, dossier, pre-cutover and post-cutover verification are required.",
);
check(
  "Verified pilot release dossier",
  verifiedPilotReleaseDossier(),
  "The exact release commit needs fresh hashed live Luxart, runtime, mutation UAT, rollback, alert and Memberzone evidence plus zero P0/P1, named approval of active Luxart notification templates and explicit cutover approval.",
);

console.log("Zone4You production launch readiness\n");
for (const item of checks) {
  if (!item.applicable) {
    console.log(`SKIP  ${item.name}`);
    console.log("      Not applicable to booking_without_payments; Stripe stays hidden and disabled.");
    continue;
  }
  console.log(`${item.passed ? "PASS" : "FAIL"}  ${item.name}`);
  if (!item.passed) console.log(`      ${item.detail}`);
}

const applicableChecks = checks.filter((item) => item.applicable);
const skipped = checks.filter((item) => !item.applicable);
const failed = applicableChecks.filter((item) => !item.passed);
console.log(`\n${applicableChecks.length - failed.length}/${applicableChecks.length} relevant automated launch checks pass.`);
if (skipped.length > 0) console.log(`${skipped.length} Stripe checks are explicitly not applicable to this launch phase.`);

if (failed.length > 0) {
  console.error("Launch status: NO-GO");
  process.exitCode = 1;
} else {
  console.log("Launch status: automated gates are green; manual UAT and cutover approval are still required.");
}
