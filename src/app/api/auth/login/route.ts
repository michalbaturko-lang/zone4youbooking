import type { LoginInput } from "@/lib/domain";
import { fail, ok } from "@/lib/apiResponse";
import { getLuxartAdapter } from "@/lib/adapterProvider";
import { readJsonWithDemoState, withDemoState } from "@/lib/demoStateTransport";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJsonWithDemoState<LoginInput>(request);
    const result = await getLuxartAdapter().login(body);
    return ok(withDemoState(result));
  } catch (error) {
    return fail(error);
  }
}
