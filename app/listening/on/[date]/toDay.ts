import { notFound } from "next/navigation";

import { getToday } from "@/actions/listening";
import type { Day } from "@/lib/dates";
import { firstDay, parseDay } from "@/lib/days";

/** The date param, if time travel reaches it. */
export async function toDay(param: string): Promise<Day> {
  const day = parseDay(param);
  if (day !== undefined && day >= firstDay && day <= (await getToday())) {
    return day;
  }
  notFound();
}
