import { ok } from "@/lib/apiResponse";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok({ status: "ok" });
}
