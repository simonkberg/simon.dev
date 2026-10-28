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
import { SkeletonStatus } from "@/components/Skeleton";
import type { Day } from "@/lib/dates";
import {
  addDays,
  dayInMonth,
  firstDay,
  fullDayLabel,
  inHistory,
  monthIndex,
} from "@/lib/days";
import { lanes } from "@/lib/scrobbleChart";

import { href, isPlainClick, TravelContext } from "./Travel";

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
        first: first * 12,
        last: Math.min(last * 12 + 11, months - 1),
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
      onClick={(event) => isPlainClick(event) && travel(to, false)}
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
  const { date, target, scrub, release } = use(TravelContext);
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
  // The last month is today's, which ends today.
  const travelTo = (index: number) => {
    const next = dayInMonth(index, day);
    return next > today ? today : next;
  };
  const max = Math.max(1, ...counts.map(({ count }) => count));
  const runs = tops ? eras(tops, counts.length) : [];
  const era = runs.find(({ first, last }) => at >= first && at <= last);
  const before = addDays(shown, -1);
  const after = addDays(shown, 1);

  // A drag goes to its month once let go, wherever the pointer is then.
  const hold = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const listening = new AbortController();
    held.current = listening;
    const letGo = () => {
      listening.abort();
      held.current = undefined;
      release();
    };
    addEventListener("pointerup", letGo, listening);
    addEventListener("pointercancel", letGo, listening);
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

export const TimeTravelSkeleton = () => (
  <SkeletonStatus>
    <div className="time-travel" aria-hidden="true">
      <div className="time-travel-tape" />
    </div>
  </SkeletonStatus>
);
