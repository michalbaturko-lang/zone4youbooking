import type { LoginInput } from "@/lib/domain";
import { fail, ok } from "@/lib/apiResponse";
import { getLuxartAdapter, isRealLuxartMode } from "@/lib/adapterProvider";
import { readJsonWithDemoState, withDemoState } from "@/lib/demoStateTransport";
import { setBookingSession } from "@/lib/session";
import { assertTrustedMutation } from "@/lib/requestSecurity";
import { assertRateLimit, rateLimitRules } from "@/lib/rateLimit";
import { parseLoginInput } from "@/lib/loginInput";
import { assertLivePersonalizedAccessReady } from "@/lib/liveAccessGate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    if (isRealLuxartMode()) assertLivePersonalizedAccessReady();
    const body = await readJsonWithDemoState<LoginInput>(request);
    const input = parseLoginInput(body);
    await assertRateLimit(request, rateLimitRules.login, input.login);
    const result = await getLuxartAdapter().login(input);
    const response = ok(withDemoState({ user: result.user }));
    if (isRealLuxartMode()) setBookingSession(response, result.user.id);
    return response;
  } catch (error) {
    return fail(error);
  }
}
