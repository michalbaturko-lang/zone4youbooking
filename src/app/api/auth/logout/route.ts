import { fail, ok } from "@/lib/apiResponse";
import { getLuxartAdapter } from "@/lib/adapterProvider";
import { readJsonWithDemoState, withDemoState } from "@/lib/demoStateTransport";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await readJsonWithDemoState(request);
    await getLuxartAdapter().logout();
    return ok(withDemoState({ ok: true }));
  } catch (error) {
    return fail(error);
  }
}
