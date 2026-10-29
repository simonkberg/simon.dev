import { notFound } from "next/navigation";

import {
  type Day,
  firstDay,
  inHistory,
  type Month,
  monthOf,
  parseDay,
} from "@/lib/dates";
import { getToday } from "@/lib/today";

interface MonthParams {
  year: string;
  month: string;
}

/** The day's params, if time travel reaches it. */
export async function toDay({
  year,
  month,
  day,
}: MonthParams & { day: string }): Promise<Day> {
  const date = `${year}-${month}-${day}`;
  if (parseDay(date) === undefined) notFound();
  return inHistory(date, await getToday()) ?? notFound();
}

/** The month's params, if time travel reaches its first day. */
export async function toMonth(params: MonthParams): Promise<Month> {
  // The history starts mid-month.
  const first =
    `${params.year}-${params.month}` === monthOf(firstDay)
      ? firstDay.slice(8)
      : "01";
  return monthOf(await toDay({ ...params, day: first }));
}
