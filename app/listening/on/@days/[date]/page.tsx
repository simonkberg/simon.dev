// Async, which the React Compiler would turn into a component it can't call outside a render.
"use no memo";

import { getDailyScrobbles } from "@/actions/listening";
import { monthOf } from "@/lib/days";

import { MonthDays } from "../../components/MonthDays";
import { toDay } from "../../toDay";

export const prefetch = "partial";
export const instant = false;

type MonthDaysPageProps = PageProps<"/listening/on/[date]">;

export function generateStaticParams(): Awaited<
  MonthDaysPageProps["params"]
>[] {
  return [{ date: "2007-12-18" }];
}

// The day's month under the tape, which the layout keeps across days.
export default async function MonthDaysPage({ params }: MonthDaysPageProps) {
  const day = await toDay((await params).date);
  const result = await getDailyScrobbles(monthOf(day));
  return (
    <MonthDays
      day={day}
      days={result.status === "ok" ? result.scrobbles : undefined}
    />
  );
}
