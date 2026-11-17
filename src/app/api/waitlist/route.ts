import { fail, ok } from "@/lib/apiResponse";
import { getRequestLuxartAdapter, isRealLuxartMode } from "@/lib/adapterProvider";
import { assertLiveBookingCreationReady } from "@/lib/bookingService";
import { readJsonWithDemoState, withDemoState } from "@/lib/demoStateTransport";
import { assertTrustedMutation, assertWaitlistMutationsEnabled } from "@/lib/requestSecurity";
import { assertRateLimit, rateLimitRules } from "@/lib/rateLimit";
import { BookingApiError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await assertRateLimit(request, rateLimitRules.accountRead);
    const waitlist = await getRequestLuxartAdapter(request).getWaitlist();
    return ok(withDemoState({ waitlist }));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    assertWaitlistMutationsEnabled();
    const body = await readJsonWithDemoState<{ lessonId?: string }>(request);
    if (typeof body.lessonId !== "string" || !body.lessonId.trim() || body.lessonId.trim() !== body.lessonId || body.lessonId.length > 256 || /[\u0000-\u001f\u007f]/.test(body.lessonId)) {
      throw new BookingApiError(400, "INVALID_LESSON_ID", "Lekci se nepodařilo identifikovat.");
    }
    await assertRateLimit(request, rateLimitRules.waitlistJoin, body.lessonId);
    const adapter = getRequestLuxartAdapter(request);
    if (isRealLuxartMode()) await assertLiveBookingCreationReady(adapter);
    const waitlistEntry = await adapter.joinWaitlist({ lessonId: body.lessonId });
    return ok(withDemoState({ waitlistEntry }), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertTrustedMutation(request);
    assertWaitlistMutationsEnabled();
    await readJsonWithDemoState(request);
    const url = new URL(request.url);
    const waitlistEntryId = url.searchParams.get("waitlistEntryId") ?? undefined;
    const lessonId = url.searchParams.get("lessonId") ?? undefined;
    await assertRateLimit(request, rateLimitRules.waitlistLeave, waitlistEntryId ?? lessonId ?? "unknown");
    await getRequestLuxartAdapter(request).leaveWaitlist({ waitlistEntryId, lessonId });
    return ok(withDemoState({ ok: true }));
  } catch (error) {
    return fail(error);
  }
}
