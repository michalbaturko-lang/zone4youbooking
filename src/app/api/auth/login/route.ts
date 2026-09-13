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
    const live = isRealLuxartMode();
    if (live) {
      assertLivePersonalizedAccessReady();
      await assertRateLimit(request, rateLimitRules.loginAddress);
    }
    const body = await readJsonWithDemoState<LoginInput>(request);
    const input = parseLoginInput(body);
    await assertRateLimit(
      request,
      live ? rateLimitRules.loginAccount : rateLimitRules.loginDemo,
      input.login,
    );
    const result = await getLuxartAdapter().login(input);
    const response = ok(withDemoState({ user: result.user }));
    if (live) setBookingSession(response, result.user.id);
    return response;
  } catch (error) {
    return fail(error);
  }
}
