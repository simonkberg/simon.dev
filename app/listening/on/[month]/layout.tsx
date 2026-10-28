// Async, which the React Compiler would turn into a component it can't call outside a render.
"use no memo";

import { monthLabel } from "@/lib/dates";
import { TopLists } from "@/listening/components/TopLists";

import { TravelPending } from "../components/Travel";
import { toMonth } from "../toDay";

export const instant = false;

type MonthLayoutProps = LayoutProps<"/listening/on/[month]">;

export function generateStaticParams(): Awaited<MonthLayoutProps["params"]>[] {
  return [{ month: "2007-12" }];
}

// The month's tops, kept as its days come and go.
export default async function MonthLayout({
  params,
  children,
}: MonthLayoutProps) {
  const month = await toMonth((await params).month);
  return (
    <>
      <TravelPending of="day">{children}</TravelPending>
      <TravelPending of="month">
        <TopLists span={month} subtitle={monthLabel(`${month}-01`)} />
      </TravelPending>
    </>
  );
}
