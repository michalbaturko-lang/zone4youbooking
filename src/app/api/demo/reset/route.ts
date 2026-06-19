import { ok } from "@/lib/apiResponse";
import { withDemoState } from "@/lib/demoStateTransport";
import { resetMockLuxartState } from "@/lib/mockLuxart";

export const dynamic = "force-dynamic";

export async function POST() {
  resetMockLuxartState();
  return ok(withDemoState({ ok: true }));
}
