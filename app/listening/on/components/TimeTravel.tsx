"use client";

import Link from "next/link";
import {
  type CSSProperties,
  type PropsWithChildren,
  type PointerEvent,
  use,
  useEffect,
  useRef,
} from "react";

import type { BucketTopArtist, ScrobbleCount } from "@/actions/listening";
import { Skeleton, SkeletonStatus } from "@/components/Skeleton";
import {
  addDays,
  type Day,
  dayInMonth,
  firstDay,
  firstYear,
  fullDayLabel,
  inHistory,
  january,
  monthIndex,
} from "@/lib/dates";
import { barHeights, lanes } from "@/lib/scrobbleChart";

import { href } from "../href";
import { MonthDaysSkeleton } from "./MonthDays";
import { TravelContext } from "./Travel";

export interface TimeTravelProps extends PropsWithChildren {
  today: Promise<Day>;
  // Each undefined when it failed to load.
  months: Promise<readonly ScrobbleCount[] | undefined>;
  years: Promise<readonly BucketTopArtist[] | undefined>;
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
        first: Math.max(january(firstYear + first), 0),
        last: Math.min(january(firstYear + last) + 11, months - 1),
      })),
    )
    .toSorted((a, b) => a.first - b.first);

interface StepProps {
  to: Day | undefined;
  label: string;
  glyph: string;
}

const Step = ({ to, label, glyph }: StepProps) => {
  const { travel } = use(TravelContext);
  return to ? (
    <Link
      href={href(to)}
      replace
      scroll={false}
      aria-label={label}
      onNavigate={(event) => travel(event, to)}
    >
      {glyph}
    </Link>
  ) : (
    <span aria-hidden="true">{glyph}</span>
  );
};

/** The month tape, kept in the layout so it stays put as the days' pages come and go. */
export const TimeTravel = ({
  today: todayPromise,
  months,
  years,
  children,
}: TimeTravelProps) => {
  const today = use(todayPromise);
  const counts = use(months);
  const tops = use(years);
  const { date, target, going, scrub, release } = use(TravelContext);
  // While a drag is held, the listeners waiting for it to be let go.
  const held = useRef<AbortController>(undefined);
  useEffect(() => () => held.current?.abort(), []);

  // The day's page answers 404 for anything else, so there's nothing to show.
  const day = date === undefined ? undefined : inHistory(date, today);
  if (day === undefined) return null;

  if (counts === undefined) {
    return <p>Time travel is temporarily unavailable :(</p>;
  }

  const shown = target ?? day;
  const at = monthIndex(shown);
  // The first month starts at the first scrobble, the last ends today.
  const travelTo = (index: number) => {
    const next = dayInMonth(index, going ?? day);
    if (next < firstDay) return firstDay;
    return next > today ? today : next;
  };
  const heights = barHeights(counts);
  const runs = tops ? eras(tops, counts.length) : [];
  const era = runs.find(({ first, last }) => at >= first && at <= last);
  const before = addDays(shown, -1);
  const after = addDays(shown, 1);

  // A drag goes to its month once let go, wherever the pointer is then.
  const hold = (event: PointerEvent) => {
    if (event.button !== 0) return;
    held.current?.abort();
    const listening = new AbortController();
    held.current = listening;
    const letGo = () => {
      listening.abort();
      held.current = undefined;
      release();
    };
    const { signal } = listening;
    addEventListener("pointerup", letGo, { signal });
    addEventListener("pointercancel", letGo, { signal });
  };

  return (
    <div
      className="time-travel"
      style={{ "--months": counts.length, "--at": at } as CSSProperties}
    >
      <div className="time-travel-readout">
        <Step
          to={before >= firstDay ? before : undefined}
          label="Day before"
          glyph="‹"
        />
        <output>{fullDayLabel(shown)}</output>
        <Step
          to={after <= today ? after : undefined}
          label="Day after"
          glyph="›"
        />
      </div>

      <div className="time-travel-tape">
        <ol aria-hidden="true">
          {counts.map(({ label }, index) => (
            <li
              key={label}
              style={
                { "--value": heights[index], "--index": index } as CSSProperties
              }
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
          onPointerDown={hold}
          onChange={(event) =>
            scrub(
              travelTo(Number(event.target.value)),
              held.current !== undefined,
            )
          }
        />
      </div>

      <ol className="time-travel-years" aria-hidden="true">
        {counts.flatMap(({ label }, index) => {
          const year =
            firstYear + Math.floor((index - january(firstYear)) / 12);
          return index === january(year) ? (
            <li
              key={label}
              style={{ "--index": index } as CSSProperties}
              data-odd={year % 2 === 1 || undefined}
            >
              {String(year).slice(-2)}
            </li>
          ) : (
            []
          );
        })}
      </ol>

      {children}

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
            <span>era · {era.name}</span>
          </p>
        </>
      )}
    </div>
  );
};

// Laid out like the tape, so it keeps its size as the tape arrives.
export const TimeTravelSkeleton = () => (
  <SkeletonStatus>
    <div className="time-travel" aria-hidden="true">
      <div className="time-travel-readout">
        <Step to={undefined} label="Day before" glyph="‹" />
        <output>
          <Skeleton width={16} />
        </output>
        <Step to={undefined} label="Day after" glyph="›" />
      </div>
      <div className="time-travel-tape" />
      <ol className="time-travel-years" />
      <MonthDaysSkeleton />
      <ol className="time-travel-eras" />
      <p className="time-travel-era">
        <span>
          <Skeleton width={24} />
        </span>
      </p>
    </div>
  </SkeletonStatus>
);
