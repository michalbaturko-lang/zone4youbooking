import { fail, ok } from "@/lib/apiResponse";
import { getBookingSnapshotForAdapter, queryFromRequest } from "@/lib/bookingService";
import { bookingRules } from "@/lib/bookingRules";
import { readJsonWithDemoState, withDemoState } from "@/lib/demoStateTransport";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const snapshot = await getBookingSnapshotForAdapter(undefined, queryFromRequest(request));
    return ok(withDemoState({ ...snapshot, rules: bookingRules }));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    await readJsonWithDemoState(request);
    const snapshot = await getBookingSnapshotForAdapter(undefined, queryFromRequest(request));
    return ok(withDemoState({ ...snapshot, rules: bookingRules }));
  } catch (error) {
    return fail(error);
  }
}
