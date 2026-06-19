import { fail, ok } from "@/lib/apiResponse";
import { getLuxartAdapter } from "@/lib/adapterProvider";
import { readJsonWithDemoState, withDemoState } from "@/lib/demoStateTransport";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const reservations = await getLuxartAdapter().getReservations();
    return ok(withDemoState({ reservations }));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonWithDemoState<{ lessonId?: string }>(request);
    if (!body.lessonId) throw new Error("Missing lessonId.");
    const reservation = await getLuxartAdapter().createReservation({ lessonId: body.lessonId });
    return ok(withDemoState({ reservation }), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
