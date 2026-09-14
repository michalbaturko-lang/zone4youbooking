import { fail, ok } from "@/lib/apiResponse";
import { getRequestLuxartAdapter, isRealLuxartMode } from "@/lib/adapterProvider";
import { readJsonWithDemoState, withDemoState } from "@/lib/demoStateTransport";
import { assertTrustedMutation } from "@/lib/requestSecurity";
import { assertRateLimit, rateLimitRules } from "@/lib/rateLimit";
import { BookingApiError } from "@/lib/errors";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    if (isRealLuxartMode()) {
      throw new BookingApiError(
        503,
        "TOPUPS_DISABLED",
        "Online dobití je do dokončení bezpečné platební integrace vypnuté.",
      );
    }
    const body = await readJsonWithDemoState<{ amountKc?: number }>(request);
    if (!body.amountKc) throw new Error("Missing amountKc.");
    await assertRateLimit(request, rateLimitRules.topup, String(body.amountKc));
    const topup = await getRequestLuxartAdapter(request).createTopup({
      amountKc: body.amountKc,
      provider: "stripe",
      idempotencyKey: `demo-${randomUUID()}`,
    });
    return ok(withDemoState({ topup }), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
