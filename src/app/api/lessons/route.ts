import { fail, ok } from "@/lib/apiResponse";
import { getLuxartAdapter } from "@/lib/adapterProvider";
import { queryFromRequest } from "@/lib/bookingService";
import { withDemoState } from "@/lib/demoStateTransport";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const lessons = await getLuxartAdapter().getLessons(queryFromRequest(request));
    return ok(withDemoState({ lessons }));
  } catch (error) {
    return fail(error);
  }
}
