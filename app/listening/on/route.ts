import { connection } from "next/server";

import { yearBefore } from "@/lib/dates";
import { getToday } from "@/lib/today";

import { href } from "./href";

// Time travel starts a year back.
export async function GET() {
  await connection();
  return new Response(null, {
    status: 307,
    headers: { Location: href(yearBefore(await getToday())) },
  });
}
