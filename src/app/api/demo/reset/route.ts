import { ok } from "@/lib/apiResponse";
import { withDemoState } from "@/lib/demoStateTransport";
import { resetMockLuxartState } from "@/lib/mockLuxart";

export const dynamic = "force-dynamic";

export async function POST() {
  const isProduction =
    process.env.NEXT_PUBLIC_APP_ENV === "production" || process.env.VERCEL_ENV === "production";

  if (process.env.LUXART_MOCK === "false" || isProduction) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  resetMockLuxartState();
  return ok(withDemoState({ ok: true }));
}
