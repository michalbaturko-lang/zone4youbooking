import type { CreateTopupInput } from "@/lib/domain";
import { fail, ok } from "@/lib/apiResponse";
import { getLuxartAdapter } from "@/lib/adapterProvider";
import { readJsonWithDemoState, withDemoState } from "@/lib/demoStateTransport";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJsonWithDemoState<Partial<CreateTopupInput>>(request);
    if (!body.amountKc) throw new Error("Missing amountKc.");
    const topup = await getLuxartAdapter().createTopup({
      amountKc: body.amountKc,
      provider: "stripe",
      idempotencyKey: body.idempotencyKey ?? `topup-${body.amountKc}-${Date.now()}`,
      providerSessionId: body.providerSessionId,
      providerPaymentIntentId: body.providerPaymentIntentId,
    });
    return ok(withDemoState({ topup }), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
