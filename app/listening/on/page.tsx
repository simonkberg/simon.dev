import { redirect } from "next/navigation";
import { connection } from "next/server";

import { yearBefore } from "@/lib/days";
import { getToday } from "@/lib/today";

export const instant = false;

// Time travel starts a year back.
export default async function TimeTravelStart() {
  await connection();
  redirect(`/listening/on/${yearBefore(await getToday())}`);
}
