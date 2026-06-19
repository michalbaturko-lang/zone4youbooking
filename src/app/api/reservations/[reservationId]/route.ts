import { fail, ok } from "@/lib/apiResponse";
import { getLuxartAdapter } from "@/lib/adapterProvider";
import { readJsonWithDemoState, withDemoState } from "@/lib/demoStateTransport";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ reservationId: string }> }) {
  try {
    await readJsonWithDemoState(request);
    const { reservationId } = await context.params;
    const reservation = await getLuxartAdapter().cancelReservation({ reservationId });
    return ok(withDemoState({ reservation }));
  } catch (error) {
    return fail(error);
  }
}
