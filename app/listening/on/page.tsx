import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getToday } from "@/actions/listening";
import { yearBefore } from "@/lib/days";

export const instant = false;

// Time travel starts a year back.
export default async function TimeTravelStart() {
  await connection();
  redirect(`/listening/on/${yearBefore(await getToday())}`);
}
