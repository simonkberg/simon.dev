"use client";

import Link from "next/link";
import { type CSSProperties, use } from "react";

import type { ScrobbleCount } from "@/actions/listening";
import type { Day } from "@/lib/dates";
import { addDays } from "@/lib/days";
import { formatPlays } from "@/lib/formatNumber";

import { href, isPlainClick, TravelContext } from "./TimeTravel";

export interface MonthDaysProps {
  day: Day;
  // Undefined when they failed to load.
  days: readonly ScrobbleCount[] | undefined;
}

/** The day's month under the tape's lens, a link to each of its days. */
export const MonthDays = ({ day, days }: MonthDaysProps) => {
  const { travel, takeFocus } = use(TravelContext);

  if (days === undefined) {
    return <p>This month’s days are temporarily unavailable :(</p>;
  }

  const dayOfMonth = Number(day.slice(8));
  const max = Math.max(1, ...days.map(({ count }) => count));

  return (
    <>
      <div className="time-travel-lens" aria-hidden="true" />
      <ol
        className="time-travel-days"
        style={{ "--days": days.length } as CSSProperties}
        aria-label="Days"
      >
        {days.map(({ label, count }, index) => {
          const date = addDays(day, index + 1 - dayOfMonth);
          const current = date === day;
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
                href={href(date)}
                replace
                scroll={false}
                aria-current={current ? "date" : undefined}
                // Each day is its own page, so the link followed is a new one.
                ref={
                  current
                    ? (link) => {
                        if (link && takeFocus(date)) link.focus();
                      }
                    : undefined
                }
                onClick={(event) =>
                  isPlainClick(event) &&
                  travel(date, event.currentTarget === document.activeElement)
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
    </>
  );
};
