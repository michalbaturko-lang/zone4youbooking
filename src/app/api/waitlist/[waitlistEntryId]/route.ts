import { fail, ok } from "@/lib/apiResponse";
import { getRequestLuxartAdapter } from "@/lib/adapterProvider";
import { readJsonWithDemoState, withDemoState } from "@/lib/demoStateTransport";
import { assertBookingMutationsEnabled, assertTrustedMutation } from "@/lib/requestSecurity";
import { assertRateLimit, rateLimitRules } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ waitlistEntryId: string }> }) {
  try {
    assertTrustedMutation(request);
    assertBookingMutationsEnabled();
    await readJsonWithDemoState(request);
    const { waitlistEntryId } = await context.params;
    await assertRateLimit(request, rateLimitRules.waitlistLeave, waitlistEntryId);
    await getRequestLuxartAdapter(request).leaveWaitlist({ waitlistEntryId });
    return ok(withDemoState({ ok: true }));
  } catch (error) {
    return fail(error);
  }
}
