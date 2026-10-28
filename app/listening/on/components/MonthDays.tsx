"use client";

import Link from "next/link";
import { type CSSProperties, use } from "react";

import type { ScrobbleCount } from "@/actions/listening";
import type { Day, Month } from "@/lib/dates";
import { formatPlays } from "@/lib/formatNumber";

import { href, isPlainClick, TravelContext, TravelPending } from "./Travel";

export interface MonthDaysProps {
  month: Month;
  // Undefined when they failed to load.
  days: readonly ScrobbleCount[] | undefined;
}

/** The day's month under the tape, a link to each of its days. */
export const MonthDays = ({ month, days }: MonthDaysProps) => {
  const { date, target, travel, takeFocus } = use(TravelContext);

  if (days === undefined) {
    return <p>This month’s days are temporarily unavailable :(</p>;
  }

  // A day the page is travelling to within the month is already here.
  const shown = target?.startsWith(month) ? target : date;
  const dayOfMonth = Number(shown?.slice(8));
  const max = Math.max(1, ...days.map(({ count }) => count));

  return (
    <TravelPending of="month">
      <ol
        className="time-travel-days"
        style={{ "--days": days.length } as CSSProperties}
        aria-label="Days"
      >
        {days.map(({ label, count }, index) => {
          const day = `${month}-${String(index + 1).padStart(2, "0")}` as Day;
          const current = day === shown;
          // Every week's first day, unless it would crowd the current one's.
          const tick =
            current ||
            (index % 7 === 0 && Math.abs(index + 1 - dayOfMonth) > 1);
          return (
            <li
              key={label}
              style={{ "--value": Math.sqrt(count / max) } as CSSProperties}
              data-active={current || undefined}
              data-tick={tick || undefined}
            >
              <Link
                href={href(day)}
                replace
                scroll={false}
                aria-current={current ? "date" : undefined}
                // A day of another month is a new page, so the link followed is a new one.
                ref={
                  current
                    ? (link) => {
                        if (link && takeFocus(day)) link.focus();
                      }
                    : undefined
                }
                onClick={(event) =>
                  isPlainClick(event) &&
                  travel(day, event.currentTarget === document.activeElement)
                }
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
