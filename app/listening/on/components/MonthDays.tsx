"use client";

import Link from "next/link";
import { type CSSProperties, use } from "react";

import type { ScrobbleCount } from "@/actions/listening";
import { addDays, type Month, monthOf } from "@/lib/dates";
import { formatPlays } from "@/lib/formatNumber";
import { barHeights } from "@/lib/scrobbleChart";

import { href } from "../href";
import { TravelContext, TravelPending } from "./Travel";

export interface MonthDaysProps {
  month: Month;
  // Undefined when they failed to load.
  days: readonly ScrobbleCount[] | undefined;
}

/** The day's month under the tape, a link to each of its days. */
export const MonthDays = ({ month, days }: MonthDaysProps) => {
  const { date, target, travel } = use(TravelContext);

  if (days === undefined) {
    return <p>This month’s days are temporarily unavailable :(</p>;
  }

  // A day the page is travelling to within the month is already here.
  const shown = target && monthOf(target) === month ? target : date;
  const dayOfMonth = Number(shown?.slice(8));
  const heights = barHeights(days);

  return (
    <TravelPending of="month">
      <ol
        className="time-travel-days"
        style={{ "--days": days.length } as CSSProperties}
        aria-label="Days"
      >
        {days.map(({ label, count }, index) => {
          const day = addDays(`${month}-01`, index);
          const current = day === shown;
          // Every week's first day, unless it would crowd the current one's.
          const tick =
            current ||
            (index % 7 === 0 && Math.abs(index + 1 - dayOfMonth) > 1);
          return (
            <li
              key={label}
              style={
                { "--value": heights[index], "--index": index } as CSSProperties
              }
              data-active={current || undefined}
              data-tick={tick || undefined}
            >
              <Link
                href={href(day)}
                replace
                scroll={false}
                aria-current={current ? "date" : undefined}
                onNavigate={(event) => travel(event, day)}
              >
                <span className="visually-hidden">{`${label}: ${formatPlays(count)}`}</span>
              </Link>
              <span className="time-travel-tick" aria-hidden="true">
                {index + 1}
              </span>
            </li>
          );
        })}
      </ol>
    </TravelPending>
  );
};

// One day: its bar and hidden tick give the strip its height.
export const MonthDaysSkeleton = () => (
  <ol className="time-travel-days" style={{ "--days": 1 } as CSSProperties}>
    <li>
      <span />
      <span className="time-travel-tick">1</span>
    </li>
  </ol>
);
