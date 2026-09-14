import { fail, ok } from "@/lib/apiResponse";
import { isRealLuxartMode } from "@/lib/adapterProvider";
import { withDemoState } from "@/lib/demoStateTransport";
import { runLoginAttempt } from "@/lib/loginService";
import { setBookingSession } from "@/lib/session";
import { assertTrustedMutation } from "@/lib/requestSecurity";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const live = isRealLuxartMode();
    const result = await runLoginAttempt(request, live);
    const response = ok(withDemoState({ user: result.user }));
    if (live) setBookingSession(response, result.user.id);
    return response;
  } catch (error) {
    return fail(error);
  }
}
