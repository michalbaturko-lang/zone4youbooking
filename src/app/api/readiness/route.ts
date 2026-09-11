import { getLuxartAdapter, isRealLuxartMode } from "@/lib/adapterProvider";
import { ok } from "@/lib/apiResponse";
import { bookingMutationsRequested } from "@/lib/bookingMutationConfig";
import { getPostgresBookingMutationLedger } from "@/lib/bookingMutationLedger";
import {
  approvedRuntimeRegion,
  deploymentPhase,
  deploymentRuntimeConfigurationProblems,
  runtimeDeploymentCommit,
  runtimeDeploymentRegion,
} from "@/lib/deploymentPreflight";
import { getPilotCapabilities } from "@/lib/pilotCapabilities";
import { getPostgresPaymentLedger } from "@/lib/paymentLedger";
import { paymentMutationsRequested } from "@/lib/paymentConfig";
import { getPostgresRateLimiter } from "@/lib/rateLimit";
import { assertLessonFeedReady, pilotLessonQuery } from "@/lib/bookingService";
import { BookingApiError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isRealLuxartMode()) {
    const commit = runtimeDeploymentCommit();
    return ok({
      status: "ready",
      mode: "demo",
      phase: "demo",
      commit: commit ?? "unverified",
      region: runtimeDeploymentRegion(),
      luxart: "mock",
      schedule: "mock",
      rateLimit: "memory",
      capabilities: getPilotCapabilities(),
    });
  }

  const phase = deploymentPhase();
  const commit = runtimeDeploymentCommit();
  const region = runtimeDeploymentRegion();
  const deployment = { phase, ...(commit ? { commit } : {}), region };

  if (region !== approvedRuntimeRegion) {
    return ok(
      {
        status: "not_ready",
        mode: "live",
        ...deployment,
        luxart: "not_checked",
        schedule: "not_checked",
        deployment: "unapproved_region",
        capabilities: getPilotCapabilities(),
      },
      { status: 503 },
    );
  }

  if (deploymentRuntimeConfigurationProblems().length > 0) {
    return ok(
      {
        status: "not_ready",
        mode: "live",
        ...deployment,
        luxart: "not_checked",
        schedule: "not_checked",
        configuration: "incomplete",
        capabilities: getPilotCapabilities(),
      },
      { status: 503 },
    );
  }

  const rateLimitMode = process.env.RATE_LIMIT_MODE as "memory" | "postgres";
  if (rateLimitMode === "postgres") {
    try {
      await getPostgresRateLimiter().assertReady();
    } catch {
      return ok(
        {
          status: "not_ready",
          mode: "live",
          ...deployment,
          luxart: "not_checked",
          schedule: "not_checked",
          rateLimit: "unready",
          capabilities: getPilotCapabilities(),
        },
        { status: 503 },
      );
    }
  }

  try {
    const query = pilotLessonQuery();
    assertLessonFeedReady(await getLuxartAdapter().getLessons(query), query);
  } catch (error) {
    const emptySchedule = error instanceof BookingApiError && error.code === "LUXART_SCHEDULE_EMPTY";
    const invalidSchedule = error instanceof BookingApiError && error.code === "LUXART_RESPONSE_INVALID";
    return ok(
      {
        status: "not_ready",
        mode: "live",
        ...deployment,
        luxart: emptySchedule || invalidSchedule ? "reachable" : "unreachable",
        schedule: emptySchedule ? "empty" : invalidSchedule ? "invalid" : "unavailable",
        rateLimit: rateLimitMode,
        capabilities: getPilotCapabilities(),
      },
      { status: 503 },
    );
  }

  if (paymentMutationsRequested()) {
    try {
      await getPostgresPaymentLedger().assertReady();
    } catch {
      return ok(
        {
          status: "not_ready",
          mode: "live",
          ...deployment,
          luxart: "reachable",
          schedule: "ready",
          rateLimit: rateLimitMode,
          payments: "ledger_unready",
          capabilities: getPilotCapabilities(),
        },
        { status: 503 },
      );
    }
  }

  if (bookingMutationsRequested()) {
    try {
      await getPostgresBookingMutationLedger().assertReady();
    } catch {
      return ok(
        {
          status: "not_ready",
          mode: "live",
          ...deployment,
          luxart: "reachable",
          schedule: "ready",
          rateLimit: rateLimitMode,
          booking: "ledger_unready",
          payments: paymentMutationsRequested() ? "ready" : "disabled",
          capabilities: getPilotCapabilities(),
        },
        { status: 503 },
      );
    }
  }

  return ok({
    status: "ready",
    mode: "live",
    ...deployment,
    luxart: "reachable",
    schedule: "ready",
    rateLimit: rateLimitMode,
    booking: bookingMutationsRequested() ? "ready" : "read_only",
    payments: paymentMutationsRequested() ? "ready" : "disabled",
    capabilities: getPilotCapabilities(),
  });
}
