import { connection } from "next/server";

import { yearBefore } from "@/lib/dates";
import { getToday } from "@/lib/today";

// Time travel starts a year back.
export async function GET() {
  await connection();
  return new Response(null, {
    status: 307,
    headers: { Location: `/listening/on/${yearBefore(await getToday())}` },
  });
}
