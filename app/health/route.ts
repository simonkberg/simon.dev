import { connection } from "next/server";

import { getPendingStages } from "@/lib/readiness";

export async function GET() {
  await connection();
  const pending = getPendingStages();
  if (pending.length > 0) {
    return Response.json({ status: "starting", pending }, { status: 503 });
  }
  return new Response("OK", { status: 200 });
}
