import { fail, ok } from "@/lib/apiResponse";
import { getLuxartAdapter } from "@/lib/adapterProvider";
import { readJsonWithDemoState, withDemoState } from "@/lib/demoStateTransport";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ waitlistEntryId: string }> }) {
  try {
    await readJsonWithDemoState(request);
    const { waitlistEntryId } = await context.params;
    await getLuxartAdapter().leaveWaitlist({ waitlistEntryId });
    return ok(withDemoState({ ok: true }));
  } catch (error) {
    return fail(error);
  }
}
