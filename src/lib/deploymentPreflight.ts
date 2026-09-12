import { bookingMutationConfigurationProblems } from "./bookingMutationConfig";
import {
  businessRulesProfile,
  businessRulesProfileSha256,
  type BusinessRulesEnvironment,
  type BusinessRulesProfile,
} from "./businessRuleConfirmation";
import { assertConfirmedLuxartGatewayAuth, type LuxartGatewayAuthMode } from "./luxartGatewayAuth";
import { luxartApiContract, type LuxartApiContract } from "./luxartApiContract";
import { validLuxartResourceMapping, validLuxartTextMapping } from "./luxartMappings";
import { paymentConfigurationProblems } from "./paymentConfig";
import {
  paymentProductProfile,
  paymentProductProfileSha256,
} from "./paymentProductProfile";
import { rateLimitConfigurationProblems } from "./rateLimit";

export type DeploymentTarget = "staging" | "production";
export type DeploymentPhase = "read_only" | "booking_without_payments" | "booking_with_stripe";

export const approvedRuntimeRegion = "fra1" as const;

export interface DeploymentPreflightIssue {
  code: string;
  variables: string[];
}

export interface DeploymentPreflightReport {
  ok: boolean;
  checkedAt: string;
  target: DeploymentTarget | "invalid";
  phase: DeploymentPhase | "invalid";
  applicationOrigin?: string;
  commit?: string;
  configuration: {
    luxartMode: "live" | "invalid";
    luxartApiContract: LuxartApiContract | "invalid";
    luxartTransport: "https" | "approved_test_http" | "invalid";
    gatewayAuthMode: LuxartGatewayAuthMode | "invalid";
    rateLimitMode: "memory" | "postgres" | "invalid";
    bookingMutations: "enabled" | "disabled";
    payments: "enabled" | "disabled";
    waitlist: "enabled" | "disabled" | "invalid";
    notifications: "luxart" | "invalid";
  };
  profiles: {
    businessRulesStatus: "provisional" | "confirmed";
    businessRulesSha256: string;
    paymentProductStatus: "provisional" | "confirmed";
    paymentProductSha256: string;
  };
  issues: DeploymentPreflightIssue[];
}

export const deploymentCliOnlyVariables = [
  "BOOKING_TEST_DATABASE_URL",
  "PAYMENT_TEST_DATABASE_URL",
  "RATE_LIMIT_TEST_DATABASE_URL",
  "LUXART_TEST_LOGIN",
  "LUXART_TEST_PASSWORD",
  "LUXART_TEST_MEMBER_CARD_NUMBER",
  "LUXART_HELP_URL",
  "LUXART_APPROVED_ORIGIN_SHA256",
  "LUXART_EXPECTED_PORT",
  "LUXART_HELP_PROBE_TIMEOUT_MS",
  "LUXART_REQUIRE_AUTHENTICATED_PROBE",
  "ZONE4YOU_LUXART_EVIDENCE_OUTPUT_PATH",
  "ZONE4YOU_UAT_APP_URL",
  "ZONE4YOU_UAT_MUTATION_CONFIRMATION",
  "ZONE4YOU_UAT_EXPECTED_COMMIT",
  "ZONE4YOU_UAT_EXPECTED_PHASE",
  "ZONE4YOU_UAT_LOGIN",
  "ZONE4YOU_UAT_PASSWORD",
  "ZONE4YOU_UAT_MEMBER_CARD_NUMBER",
  "ZONE4YOU_UAT_EXPECTED_USER_ID",
  "ZONE4YOU_UAT_LESSON_ID",
  "ZONE4YOU_UAT_EXPECTED_CANCELLATION_FEE_KC",
  "ZONE4YOU_UAT_MIN_HOURS_BEFORE_START",
  "ZONE4YOU_UAT_TIMEOUT_MS",
  "ZONE4YOU_UAT_ALLOW_LOCAL_HTTP",
  "ZONE4YOU_ROLLBACK_APP_URL",
  "ZONE4YOU_ROLLBACK_CONFIRMATION",
  "ZONE4YOU_ROLLBACK_EXPECTED_COMMIT",
  "ZONE4YOU_ROLLBACK_STARTED_AT",
  "ZONE4YOU_ROLLBACK_TIMEOUT_MS",
  "ZONE4YOU_ROLLBACK_MAX_SECONDS",
  "ZONE4YOU_ROLLBACK_ALLOW_LOCAL_HTTP",
  "ZONE4YOU_DNS_BASELINE_OUTPUT_PATH",
  "ZONE4YOU_DNS_BASELINE_CAPTURE_CONFIRMATION",
  "ZONE4YOU_DNS_BASELINE_EVIDENCE_PATH",
  "ZONE4YOU_DNS_BASELINE_VERIFY_CONFIRMATION",
  "ZONE4YOU_PRECUTOVER_CONFIRMATION",
  "ZONE4YOU_PRECUTOVER_EVIDENCE_OUTPUT_PATH",
  "ZONE4YOU_PRECUTOVER_EVIDENCE_PATH",
  "ZONE4YOU_PRECUTOVER_MAX_AGE_MINUTES",
  "ZONE4YOU_PRODUCTION_APP_URL",
  "ZONE4YOU_PRODUCTION_EXPECTED_COMMIT",
  "ZONE4YOU_PRODUCTION_EXPECTED_PHASE",
  "ZONE4YOU_PRODUCTION_CUTOVER_CONFIRMATION",
  "ZONE4YOU_PRODUCTION_TIMEOUT_MS",
  "ZONE4YOU_PRODUCTION_MAX_SECONDS",
  "ZONE4YOU_RELEASE_DOSSIER_PATH",
  "ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION",
  "ZONE4YOU_RELEASE_COMMIT",
  "ZONE4YOU_ALERT_APP_URL",
  "ZONE4YOU_ALERT_WEBHOOK_URL",
  "ZONE4YOU_ALERT_BEARER_TOKEN",
  "ZONE4YOU_ALERT_SUPPORT_OWNER",
  "ZONE4YOU_ALERT_CONFIRMATION",
  "ZONE4YOU_ALERT_TIMEOUT_MS",
  "ZONE4YOU_ALERT_ALLOW_LOCAL_HTTP",
  "ZONE4YOU_ALERT_DELIVERY_CONFIRMED",
  "ZONE4YOU_ALERT_EVIDENCE_PATH",
  "ZONE4YOU_BOOKING_UAT_EVIDENCE_PATH",
  "ZONE4YOU_LUXART_EVIDENCE_PATH",
  "ZONE4YOU_RELEASE_DOSSIER_OUTPUT_PATH",
  "ZONE4YOU_RELEASE_ID",
  "ZONE4YOU_RELEASE_MAXIMUM_EVIDENCE_AGE_HOURS",
  "ZONE4YOU_RELEASE_WINDOW_ENDS_AT",
  "ZONE4YOU_RELEASE_WINDOW_STARTS_AT",
  "ZONE4YOU_ROLLBACK_EVIDENCE_PATH",
  "ZONE4YOU_RUNTIME_EVIDENCE_PATH",
  "ZONE4YOU_STRIPE_UAT_EVIDENCE_PATH",
  "PROBE_ALLOW_SINGLE_INSTANCE",
  "PROBE_REQUIRE_REFORMER",
  "PROBE_TIMEOUT_MS",
  "VERCEL_PROTECTION_BYPASS",
  "PLAYWRIGHT_EXTERNAL_DEMO_URL",
  "PLAYWRIGHT_EXPECTED_DEMO_COMMIT",
] as const;

const secretVariables = [
  "LUXART_API_BASIC_PASSWORD",
  "LUXART_API_BEARER_TOKEN",
  "LUXART_API_AUTH_HEADER_VALUE",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
] as const;

function issue(code: string, ...variables: string[]): DeploymentPreflightIssue {
  return { code, variables: [...new Set(variables)].sort() };
}

function configured(environment: BusinessRulesEnvironment, name: string) {
  return typeof environment[name] === "string" && environment[name]!.trim().length > 0;
}

function cleanRootHttpsOrigin(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.hostname.endsWith(".invalid") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) return undefined;
    return `${url.origin}/`;
  } catch {
    return undefined;
  }
}

function validResourceMap(value: string | undefined) {
  return validLuxartResourceMapping(value);
}

function deploymentCommit(environment: BusinessRulesEnvironment) {
  const vercelCommit = environment.VERCEL_GIT_COMMIT_SHA?.trim();
  const explicitCommit = environment.ZONE4YOU_DEPLOYMENT_COMMIT?.trim();
  if (vercelCommit && explicitCommit && vercelCommit !== explicitCommit) return undefined;
  const commit = vercelCommit || explicitCommit;
  return commit && /^[a-f0-9]{40}$/i.test(commit) ? commit.toLowerCase() : undefined;
}

function luxartTransport(
  environment: BusinessRulesEnvironment,
  target: DeploymentTarget | "invalid",
): DeploymentPreflightReport["configuration"]["luxartTransport"] {
  const raw = environment.LUXART_API_BASE_URL;
  if (!raw) return "invalid";
  try {
    const url = new URL(raw);
    if (
      !url.hostname ||
      url.hostname.endsWith(".invalid") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) return "invalid";
    if (url.protocol === "https:") return "https";
    if (
      url.protocol === "http:" &&
      target === "staging" &&
      environment.LUXART_ALLOW_INSECURE_TEST_HTTP === "true"
    ) return "approved_test_http";
    return "invalid";
  } catch {
    return "invalid";
  }
}

export function deploymentTarget(
  environment: BusinessRulesEnvironment = process.env,
): DeploymentTarget | "invalid" {
  return ["staging", "production"].includes(environment.ZONE4YOU_DEPLOYMENT_TARGET ?? "")
    ? environment.ZONE4YOU_DEPLOYMENT_TARGET as DeploymentTarget
    : "invalid";
}

export function deploymentPhase(
  environment: BusinessRulesEnvironment = process.env,
): DeploymentPhase | "invalid" {
  return ["read_only", "booking_without_payments", "booking_with_stripe"].includes(
    environment.ZONE4YOU_DEPLOYMENT_PHASE ?? "",
  ) ? environment.ZONE4YOU_DEPLOYMENT_PHASE as DeploymentPhase : "invalid";
}

export function deploymentRuntimeConfigurationProblems(
  environment: BusinessRulesEnvironment = process.env,
  profile: BusinessRulesProfile = businessRulesProfile,
) {
  const issues: DeploymentPreflightIssue[] = [];
  const target = deploymentTarget(environment);
  const phase = deploymentPhase(environment);
  const appOrigin = cleanRootHttpsOrigin(environment.APP_BASE_URL);
  const transport = luxartTransport(environment, target);

  if (target === "invalid") issues.push(issue("DEPLOYMENT_TARGET", "ZONE4YOU_DEPLOYMENT_TARGET"));
  if (phase === "invalid") issues.push(issue("DEPLOYMENT_PHASE", "ZONE4YOU_DEPLOYMENT_PHASE"));
  if (!appOrigin) issues.push(issue("APP_BASE_URL", "APP_BASE_URL"));
  if (target === "production" && appOrigin !== "https://booking.zone4you.cz/") {
    issues.push(issue("PRODUCTION_APP_ORIGIN", "APP_BASE_URL"));
  }
  if (target === "staging") {
    const expectedStagingOrigin = cleanRootHttpsOrigin(environment.ZONE4YOU_STAGING_APP_ORIGIN);
    if (!expectedStagingOrigin || expectedStagingOrigin === "https://booking.zone4you.cz/") {
      issues.push(issue("STAGING_APP_ORIGIN", "ZONE4YOU_STAGING_APP_ORIGIN"));
    } else if (appOrigin !== expectedStagingOrigin) {
      issues.push(issue("STAGING_APP_ORIGIN_MISMATCH", "APP_BASE_URL", "ZONE4YOU_STAGING_APP_ORIGIN"));
    }
  }
  if (
    (target === "production" && environment.NEXT_PUBLIC_APP_ENV !== "production") ||
    (target === "staging" && environment.NEXT_PUBLIC_APP_ENV !== "staging")
  ) {
    issues.push(issue("PUBLIC_APP_ENV", "NEXT_PUBLIC_APP_ENV"));
  }
  if (!deploymentCommit(environment)) {
    issues.push(issue("DEPLOYMENT_COMMIT", "VERCEL_GIT_COMMIT_SHA", "ZONE4YOU_DEPLOYMENT_COMMIT"));
  }
  if (environment.LUXART_MOCK !== "false") issues.push(issue("LUXART_LIVE_MODE", "LUXART_MOCK"));
  if (luxartApiContract(environment) === "invalid") {
    issues.push(issue("LUXART_API_CONTRACT", "LUXART_API_CONTRACT"));
  }
  if (transport === "invalid") {
    issues.push(issue("LUXART_API_TRANSPORT", "LUXART_API_BASE_URL", "LUXART_ALLOW_INSECURE_TEST_HTTP"));
  }
  if (transport === "approved_test_http" && phase !== "read_only") {
    issues.push(issue(
      "INSECURE_HTTP_READ_ONLY_ONLY",
      "LUXART_API_BASE_URL",
      "LUXART_ALLOW_INSECURE_TEST_HTTP",
      "ZONE4YOU_DEPLOYMENT_PHASE",
    ));
  }
  if (
    transport === "approved_test_http" &&
    environment.LUXART_API_AUTH_MODE?.trim().toLowerCase() !== "none"
  ) {
    issues.push(issue(
      "INSECURE_HTTP_GATEWAY_AUTH",
      "LUXART_API_BASE_URL",
      "LUXART_API_AUTH_MODE",
    ));
  }
  if (target === "production" && environment.LUXART_ALLOW_INSECURE_TEST_HTTP !== "false") {
    issues.push(issue("PRODUCTION_INSECURE_HTTP_OVERRIDE", "LUXART_ALLOW_INSECURE_TEST_HTTP"));
  }
  if (!Number.isInteger(Number(environment.LUXART_RESORT_ID)) || Number(environment.LUXART_RESORT_ID) !== 1) {
    issues.push(issue("LUXART_RESORT_ID", "LUXART_RESORT_ID"));
  }
  const timeout = Number(environment.LUXART_TIMEOUT_MS);
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 30_000) {
    issues.push(issue("LUXART_TIMEOUT_MS", "LUXART_TIMEOUT_MS"));
  }
  for (const name of [
    "LUXART_ROOM_MAP_JSON",
    "LUXART_ROOM_MAP_EN_JSON",
    "LUXART_LESSON_TYPE_MAP_JSON",
    "LUXART_LESSON_TYPE_MAP_EN_JSON",
  ] as const) {
    if (!validLuxartTextMapping(environment[name])) issues.push(issue(name, name));
  }
  try {
    assertConfirmedLuxartGatewayAuth(environment);
  } catch {
    issues.push(issue("LUXART_GATEWAY_AUTH", "LUXART_API_AUTH_MODE", "LUXART_API_AUTH_CONFIRMED"));
  }
  for (const code of rateLimitConfigurationProblems(environment)) {
    issues.push(issue(code, code));
  }
  const sessionSecret = environment.SESSION_SECRET ?? "";
  if (sessionSecret.length < 32 || /[\r\n\0]/.test(sessionSecret) || /^(.)\1+$/.test(sessionSecret)) {
    issues.push(issue("SESSION_SECRET", "SESSION_SECRET"));
  }
  if (secretVariables.some((name) => configured(environment, name) && environment[name] === sessionSecret)) {
    issues.push(issue("SESSION_SECRET_REUSED", "SESSION_SECRET"));
  }
  if (environment.NOTIFICATION_PROVIDER !== "luxart") {
    issues.push(issue("NOTIFICATION_PROVIDER", "NOTIFICATION_PROVIDER"));
  }
  if (environment.LUXART_NOTIFICATION_TEMPLATES_CONFIRMED !== "true") {
    issues.push(issue(
      "LUXART_NOTIFICATION_TEMPLATES_UNCONFIRMED",
      "LUXART_NOTIFICATION_TEMPLATES_CONFIRMED",
    ));
  }
  if (!["true", "false"].includes(environment.LUXART_WAITLIST_ENABLED ?? "")) {
    issues.push(issue("LUXART_WAITLIST_ENABLED", "LUXART_WAITLIST_ENABLED"));
  }
  if (environment.LUXART_WAITLIST_ENABLED === "true" && environment.LUXART_WATCHDOG_VARIANT !== "watchdog_III") {
    issues.push(issue("LUXART_WATCHDOG_VARIANT", "LUXART_WATCHDOG_VARIANT"));
  }

  if (phase === "read_only") {
    if (environment.BOOKING_MUTATIONS_ENABLED !== "false") {
      issues.push(issue("BOOKING_MUTATIONS_MUST_BE_DISABLED", "BOOKING_MUTATIONS_ENABLED"));
    }
    if (environment.PAYMENT_MUTATIONS_ENABLED !== "false") {
      issues.push(issue("PAYMENT_MUTATIONS_MUST_BE_DISABLED", "PAYMENT_MUTATIONS_ENABLED"));
    }
    if (environment.LUXART_WAITLIST_ENABLED !== "false") {
      issues.push(issue("WAITLIST_MUST_BE_DISABLED", "LUXART_WAITLIST_ENABLED"));
    }
  }

  if (phase === "booking_without_payments" || phase === "booking_with_stripe") {
    if (!validResourceMap(environment.LUXART_RESOURCE_MAP_JSON)) {
      issues.push(issue("LUXART_RESOURCE_MAP_JSON", "LUXART_RESOURCE_MAP_JSON"));
    }
    for (const code of bookingMutationConfigurationProblems(environment, profile)) {
      issues.push(issue(code, code));
    }
  }

  if (phase === "booking_without_payments" && environment.PAYMENT_MUTATIONS_ENABLED !== "false") {
    issues.push(issue("PAYMENT_MUTATIONS_MUST_BE_DISABLED", "PAYMENT_MUTATIONS_ENABLED"));
  }
  if (phase === "booking_without_payments" && environment.LUXART_WAITLIST_ENABLED !== "false") {
    issues.push(issue("WAITLIST_MUST_BE_DISABLED", "LUXART_WAITLIST_ENABLED"));
  }
  if (phase === "booking_with_stripe") {
    for (const code of paymentConfigurationProblems(environment, profile)) {
      issues.push(issue(code, code));
    }
  }

  const riskyPublicVariables = Object.keys(environment).filter((name) =>
    name.startsWith("NEXT_PUBLIC_") &&
    name !== "NEXT_PUBLIC_APP_ENV" &&
    /(SECRET|PASSWORD|TOKEN|KEY|DATABASE|CREDENTIAL)/i.test(name) &&
    configured(environment, name),
  );
  if (riskyPublicVariables.length > 0) {
    issues.push(issue("PUBLIC_SECRET_VARIABLE", ...riskyPublicVariables));
  }
  const deployedCliOnlyVariables = deploymentCliOnlyVariables.filter((name) => configured(environment, name));
  if (deployedCliOnlyVariables.length > 0) {
    issues.push(issue("CLI_ONLY_VARIABLE_DEPLOYED", ...deployedCliOnlyVariables));
  }

  const deduplicated = new Map<string, DeploymentPreflightIssue>();
  for (const current of issues) {
    const key = `${current.code}:${current.variables.join(",")}`;
    deduplicated.set(key, current);
  }
  return [...deduplicated.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function buildDeploymentPreflightReport(
  environment: BusinessRulesEnvironment = process.env,
  options: {
    profile?: BusinessRulesProfile;
    expectedCommit?: string;
    now?: Date;
  } = {},
): DeploymentPreflightReport {
  const profile = options.profile ?? businessRulesProfile;
  const issues = deploymentRuntimeConfigurationProblems(environment, profile);
  const commit = deploymentCommit(environment);
  if (options.expectedCommit && commit && commit !== options.expectedCommit.toLowerCase()) {
    issues.push(issue("DEPLOYMENT_COMMIT_MISMATCH", "VERCEL_GIT_COMMIT_SHA", "ZONE4YOU_DEPLOYMENT_COMMIT"));
  }
  const target = deploymentTarget(environment);
  const phase = deploymentPhase(environment);
  let gatewayAuthMode: LuxartGatewayAuthMode | "invalid" = "invalid";
  try {
    gatewayAuthMode = assertConfirmedLuxartGatewayAuth(environment).mode;
  } catch {
    // The issue list contains only safe variable names, never the rejected value.
  }
  const appOrigin = cleanRootHttpsOrigin(environment.APP_BASE_URL);
  return {
    ok: issues.length === 0,
    checkedAt: (options.now ?? new Date()).toISOString(),
    target,
    phase,
    ...(appOrigin ? { applicationOrigin: appOrigin } : {}),
    ...(commit ? { commit } : {}),
    configuration: {
      luxartMode: environment.LUXART_MOCK === "false" ? "live" : "invalid",
      luxartApiContract: luxartApiContract(environment),
      luxartTransport: luxartTransport(environment, target),
      gatewayAuthMode,
      rateLimitMode: ["memory", "postgres"].includes(environment.RATE_LIMIT_MODE ?? "")
        ? environment.RATE_LIMIT_MODE as "memory" | "postgres"
        : "invalid",
      bookingMutations: environment.BOOKING_MUTATIONS_ENABLED === "true" ? "enabled" : "disabled",
      payments: environment.PAYMENT_MUTATIONS_ENABLED === "true" ? "enabled" : "disabled",
      waitlist: environment.LUXART_WAITLIST_ENABLED === "true"
        ? "enabled"
        : environment.LUXART_WAITLIST_ENABLED === "false" ? "disabled" : "invalid",
      notifications:
        environment.NOTIFICATION_PROVIDER === "luxart" &&
        environment.LUXART_NOTIFICATION_TEMPLATES_CONFIRMED === "true"
          ? "luxart"
          : "invalid",
    },
    profiles: {
      businessRulesStatus: profile.status,
      businessRulesSha256: businessRulesProfileSha256(profile),
      paymentProductStatus: paymentProductProfile.status,
      paymentProductSha256: paymentProductProfileSha256(),
    },
    issues: [...issues].sort((a, b) => a.code.localeCompare(b.code)),
  };
}

export function runtimeDeploymentCommit(environment: BusinessRulesEnvironment = process.env) {
  return deploymentCommit(environment);
}

export function runtimeDeploymentRegion(environment: BusinessRulesEnvironment = process.env) {
  return environment.VERCEL_REGION?.trim().toLowerCase() || "unknown";
}
