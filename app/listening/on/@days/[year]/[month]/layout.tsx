// Async, which the React Compiler would turn into a component it can't call outside a render.
"use no memo";

import { getDailyScrobbles } from "@/actions/listening";

import { MonthDays } from "../../../components/MonthDays";
import { toMonth } from "../../../toDay";

export const instant = false;

type MonthDaysLayoutProps = LayoutProps<"/listening/on/[year]/[month]">;

export function generateStaticParams(): Awaited<
  MonthDaysLayoutProps["params"]
>[] {
  return [{ year: "2007", month: "12" }];
}

// The day's month under the tape, kept across its days.
export default async function MonthDaysLayout({
  params,
  children,
}: MonthDaysLayoutProps) {
  const month = await toMonth(await params);
  const result = await getDailyScrobbles(month);
  return (
    <>
      <MonthDays
        month={month}
        days={result.status === "ok" ? result.scrobbles : undefined}
      />
      {children}
    </>
  );
}
