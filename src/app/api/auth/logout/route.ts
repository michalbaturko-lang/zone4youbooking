import { fail, ok } from "@/lib/apiResponse";
import { getRequestLuxartAdapter, isRealLuxartMode } from "@/lib/adapterProvider";
import { readJsonWithDemoState, withDemoState } from "@/lib/demoStateTransport";
import { clearBookingSession } from "@/lib/session";
import { assertTrustedMutation } from "@/lib/requestSecurity";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    await readJsonWithDemoState(request);
    const live = isRealLuxartMode();
    if (!live) await getRequestLuxartAdapter(request).logout();
    const response = ok(withDemoState({ ok: true }));
    if (live) clearBookingSession(response);
    return response;
  } catch (error) {
    return fail(error);
  }
}
