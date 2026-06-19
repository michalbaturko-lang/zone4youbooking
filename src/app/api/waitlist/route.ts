import { fail, ok } from "@/lib/apiResponse";
import { getLuxartAdapter } from "@/lib/adapterProvider";
import { readJsonWithDemoState, withDemoState } from "@/lib/demoStateTransport";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const waitlist = await getLuxartAdapter().getWaitlist();
    return ok(withDemoState({ waitlist }));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonWithDemoState<{ lessonId?: string }>(request);
    if (!body.lessonId) throw new Error("Missing lessonId.");
    const waitlistEntry = await getLuxartAdapter().joinWaitlist({ lessonId: body.lessonId });
    return ok(withDemoState({ waitlistEntry }), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await readJsonWithDemoState(request);
    const url = new URL(request.url);
    const waitlistEntryId = url.searchParams.get("waitlistEntryId") ?? undefined;
    const lessonId = url.searchParams.get("lessonId") ?? undefined;
    await getLuxartAdapter().leaveWaitlist({ waitlistEntryId, lessonId });
    return ok(withDemoState({ ok: true }));
  } catch (error) {
    return fail(error);
  }
}
