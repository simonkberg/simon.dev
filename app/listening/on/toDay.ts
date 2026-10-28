import { notFound } from "next/navigation";

import type { Day, Month } from "@/lib/dates";
import { inHistory, monthOf, parseDay } from "@/lib/days";
import { getToday } from "@/lib/today";

/** The day's params, if time travel reaches it. */
export async function toDay({
  month,
  day,
}: {
  month: string;
  day: string;
}): Promise<Day> {
  const date = `${month}-${day}`;
  if (parseDay(date) === undefined) notFound();
  return inHistory(date, await getToday()) ?? notFound();
}

/** The month param, if time travel reaches its first day. */
export const toMonth = async (param: string): Promise<Month> =>
  monthOf(await toDay({ month: param, day: "01" }));
