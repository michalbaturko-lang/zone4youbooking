import { fail, ok } from "@/lib/apiResponse";
import { getRequestLuxartAdapter } from "@/lib/adapterProvider";
import { assertLessonFeedWithinQuery, queryFromRequest } from "@/lib/bookingService";
import { withDemoState } from "@/lib/demoStateTransport";
import { assertRateLimit, rateLimitRules } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await assertRateLimit(request, rateLimitRules.scheduleRead);
    const query = queryFromRequest(request);
    const lessons = assertLessonFeedWithinQuery(await getRequestLuxartAdapter(request).getLessons(query), query);
    return ok(withDemoState({ lessons }));
  } catch (error) {
    return fail(error);
  }
}
