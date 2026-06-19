import { fail, ok } from "@/lib/apiResponse";
import { getLuxartAdapter } from "@/lib/adapterProvider";
import { withDemoState } from "@/lib/demoStateTransport";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const transactions = await getLuxartAdapter().getCreditTransactions();
    return ok(withDemoState({ transactions }));
  } catch (error) {
    return fail(error);
  }
}
