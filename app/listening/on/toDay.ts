import { notFound } from "next/navigation";

import {
  type Day,
  firstOfMonth,
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
export async function toMonth({ year, month }: MonthParams): Promise<Month> {
  const first = firstOfMonth(`${year}-${month}` as Month);
  return monthOf(await toDay({ year, month, day: first.slice(8) }));
}
