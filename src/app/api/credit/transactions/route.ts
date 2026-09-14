import { fail, ok } from "@/lib/apiResponse";
import { getRequestLuxartAdapter } from "@/lib/adapterProvider";
import { withDemoState } from "@/lib/demoStateTransport";
import { assertRateLimit, rateLimitRules } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await assertRateLimit(request, rateLimitRules.accountRead);
    const transactions = await getRequestLuxartAdapter(request).getCreditTransactions();
    return ok(withDemoState({ transactions }));
  } catch (error) {
    return fail(error);
  }
}
