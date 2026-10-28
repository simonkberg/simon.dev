"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type CSSProperties, use, useEffect, useRef, useState } from "react";

import type { BucketTopArtist, ScrobbleCount } from "@/actions/listening";
import { SkeletonStatus } from "@/components/Skeleton";
import type { Day } from "@/lib/dates";
import {
  addDays,
  dayInMonth,
  fullDayLabel,
  daysInMonth,
  firstDay,
  monthIndex,
} from "@/lib/days";
import { formatPlays } from "@/lib/formatNumber";
import { lanes } from "@/lib/scrobbleChart";

export interface TimeTravelProps {
  day: Day;
  today: Day;
  // Each undefined when it failed to load.
  months: Promise<readonly ScrobbleCount[] | undefined>;
  years: Promise<readonly BucketTopArtist[] | undefined>;
  days: Promise<readonly ScrobbleCount[] | undefined>;
}

interface Era {
  name: string;
  first: number;
  last: number;
}

// Each year's top artist, as runs of months.
const eras = (years: readonly BucketTopArtist[], months: number): Era[] =>
  lanes(
    years.map(({ label }) => ({ label, count: 0, current: false })),
    years,
  )
    .flatMap(({ name, runs }) =>
      runs.map(({ first, last }) => ({
        name,
        first: first * 12,
        last: Math.min(last * 12 + 11, months - 1),
      })),
    )
    .toSorted((a, b) => a.first - b.first);

const href = (day: Day) => `/listening/on/${day}` as const;

interface StepProps {
  to: Day | undefined;
  label: string;
  glyph: string;
  onClick: (to: Day) => void;
}

const Step = ({ to, label, glyph, onClick }: StepProps) =>
  to ? (
    <Link
      href={href(to)}
      replace
      scroll={false}
      aria-label={label}
      onClick={() => onClick(to)}
    >
      {glyph}
    </Link>
  ) : (
    <span aria-hidden="true">{glyph}</span>
  );

// Long enough that a drag across the tape navigates once, where it stops.
const SCRUB_MS = 300;

export const TimeTravel = ({
  day,
  today,
  months,
  years,
  days,
}: TimeTravelProps) => {
  const counts = use(months);
  const tops = use(years);
  const dayCounts = use(days);
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The month dragged to, until its page arrives.
  const [scrubbed, setScrubbed] = useState<number>();
  // Reset here rather than by remounting, which would drop the slider's focus.
  const [shownDay, setShownDay] = useState(day);

  if (day !== shownDay) {
    setShownDay(day);
    setScrubbed(undefined);
  }

  // A day reached another way (back, forward) wins over a pending drag.
  useEffect(() => () => clearTimeout(timer.current), [day]);

  if (counts === undefined) {
    return <p>Time travel is temporarily unavailable :(</p>;
  }

  const selected = monthIndex(day);
  const at = scrubbed ?? selected;
  // The last month is today's, which ends today.
  const travelTo = (index: number) => {
    const next = dayInMonth(index, day);
    return next > today ? today : next;
  };
  const shown = scrubbed === undefined ? day : travelTo(scrubbed);
  const max = Math.max(1, ...counts.map(({ count }) => count));
  const dayMax = Math.max(1, ...(dayCounts ?? []).map(({ count }) => count));
  const dayOfMonth = Number(day.slice(8));
  const plays = dayCounts?.[dayOfMonth - 1]?.count;
  const runs = tops ? eras(tops, counts.length) : [];
  const era = runs.find(({ first, last }) => at >= first && at <= last);
  const before = addDays(shown, -1);
  const after = addDays(shown, 1);
  // A step during a drag goes from the day dragged to, instead of the drag.
  const cancelScrub = (to: Day) => {
    clearTimeout(timer.current);
    // Following a link to the shown day changes no `day`, so let go of the drag here.
    if (to === day) setScrubbed(undefined);
  };

  const scrub = (index: number) => {
    setScrubbed(index);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = travelTo(index);
      // Landing on the shown day changes no `day`, so let go of the drag here.
      if (next === day) setScrubbed(undefined);
      else router.replace(href(next), { scroll: false });
    }, SCRUB_MS);
  };

  return (
    <div
      className="time-travel"
      style={
        {
          "--months": counts.length,
          "--at": at,
          "--days": daysInMonth(day),
        } as CSSProperties
      }
      data-scrubbing={scrubbed !== undefined || undefined}
    >
      <div className="time-travel-readout">
        <Step
          to={before >= firstDay ? before : undefined}
          label="Day before"
          glyph="‹"
          onClick={cancelScrub}
        />
        <output>{fullDayLabel(shown)}</output>
        <Step
          to={after <= today ? after : undefined}
          label="Day after"
          glyph="›"
          onClick={cancelScrub}
        />
        {scrubbed === undefined && plays !== undefined && (
          <span className="time-travel-plays">{formatPlays(plays)}</span>
        )}
      </div>

      <div className="time-travel-tape">
        <ol aria-hidden="true">
          {counts.map(({ label, count }, index) => (
            <li
              key={label}
              // Square-rooted, so quiet years still show.
              style={{ "--value": Math.sqrt(count / max) } as CSSProperties}
              data-active={index === at || undefined}
            />
          ))}
        </ol>
        <span className="time-travel-head" aria-hidden="true" />
        <input
          type="range"
          min={0}
          max={counts.length - 1}
          value={at}
          aria-label="Month"
          aria-valuetext={counts[at]?.label}
          onChange={(event) => scrub(Number(event.target.value))}
        />
      </div>

      <ol className="time-travel-years" aria-hidden="true">
        {counts.flatMap(({ label }, index) =>
          index % 12 === 0 ? (
            <li
              key={label}
              style={{ "--index": index } as CSSProperties}
              data-odd={(index / 12) % 2 === 1 || undefined}
            >
              {label.slice(-2)}
            </li>
          ) : (
            []
          ),
        )}
      </ol>

      <div className="time-travel-lens" aria-hidden="true" />

      {dayCounts === undefined ? (
        <p>This month’s days are temporarily unavailable :(</p>
      ) : (
        <ol className="time-travel-days" aria-label="Days">
          {dayCounts.map(({ label, count }, index) => {
            const date = addDays(day, index + 1 - dayOfMonth);
            const text = `${label}: ${formatPlays(count)}`;
            const current = date === day;
            // Every week's first day, unless it would crowd the current one's.
            const tick =
              current ||
              (index % 7 === 0 && Math.abs(index + 1 - dayOfMonth) > 1);
            return (
              <li
                key={label}
                style={
                  { "--value": Math.sqrt(count / dayMax) } as CSSProperties
                }
                data-active={current || undefined}
                data-tick={tick || undefined}
              >
                {/* A link even when current, so the one followed keeps focus. */}
                <Link
                  href={href(date)}
                  replace
                  scroll={false}
                  aria-current={current ? "date" : undefined}
                  onClick={() => cancelScrub(date)}
                >
                  <span className="visually-hidden">{text}</span>
                </Link>
                <span className="time-travel-tick" aria-hidden="true">
                  {index + 1}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {era && (
        <>
          <ol className="time-travel-eras" aria-hidden="true">
            {runs.map((run) => (
              <li
                key={run.first}
                style={
                  { "--first": run.first, "--last": run.last } as CSSProperties
                }
                data-active={run === era || undefined}
              />
            ))}
          </ol>
          <p
            className="time-travel-era"
            style={{ "--first": era.first } as CSSProperties}
          >
            era · {era.name}
          </p>
        </>
      )}
    </div>
  );
};

export const TimeTravelSkeleton = () => (
  <SkeletonStatus>
    <div className="time-travel" aria-hidden="true">
      <div className="time-travel-tape" />
    </div>
  </SkeletonStatus>
);
