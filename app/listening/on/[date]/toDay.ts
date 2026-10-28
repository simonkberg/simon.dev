import { notFound } from "next/navigation";

import { getToday } from "@/actions/listening";
import type { Day } from "@/lib/dates";
import { inHistory, parseDay } from "@/lib/days";

/** The date param, if time travel reaches it. */
export async function toDay(param: string): Promise<Day> {
  if (parseDay(param) === undefined) notFound();
  return inHistory(param, await getToday()) ?? notFound();
}
