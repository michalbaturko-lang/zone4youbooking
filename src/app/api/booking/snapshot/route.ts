import { fail, ok } from "@/lib/apiResponse";
import { getBookingSnapshotForAdapter, queryFromRequest } from "@/lib/bookingService";
import { bookingRules } from "@/lib/bookingRules";
import { readJsonWithDemoState, withDemoState } from "@/lib/demoStateTransport";
import { getRequestLuxartAdapter } from "@/lib/adapterProvider";
import { getPilotCapabilities } from "@/lib/pilotCapabilities";
import { assertRateLimit, rateLimitRules } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await assertRateLimit(request, rateLimitRules.scheduleRead);
    const snapshot = await getBookingSnapshotForAdapter(getRequestLuxartAdapter(request), queryFromRequest(request));
    return ok(withDemoState({ ...snapshot, rules: bookingRules, capabilities: getPilotCapabilities() }));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    await assertRateLimit(request, rateLimitRules.scheduleRead);
    await readJsonWithDemoState(request);
    const snapshot = await getBookingSnapshotForAdapter(getRequestLuxartAdapter(request), queryFromRequest(request));
    return ok(withDemoState({ ...snapshot, rules: bookingRules, capabilities: getPilotCapabilities() }));
  } catch (error) {
    return fail(error);
  }
}
