"use client";

import { animated } from "@react-spring/web";
import { type CSSProperties, use } from "react";

import type {
  DayInYear,
  OnThisDay as OnThisDayData,
  PlayedYear,
} from "@/actions/lastfm";
import { Skeleton, SkeletonStatus } from "@/components/Skeleton";
import { countUp, useGrow } from "@/components/useGrow";
import { formatPlays } from "@/lib/formatNumber";

export interface OnThisDayProps {
  // Undefined when the days failed to load.
  days: Promise<OnThisDayData | undefined>;
}

type Stop =
  | { kind: "played"; year: PlayedYear }
  | { kind: "silent"; from: string; to: string };

// Years with nothing played fold into one quiet stretch of rail.
const toStops = (years: readonly DayInYear[]): Stop[] => {
  const stops: Stop[] = [];
  for (const year of years) {
    const last = stops.at(-1);
    if (year.top) stops.push({ kind: "played", year });
    else if (last?.kind === "silent") last.from = year.year;
    else stops.push({ kind: "silent", from: year.year, to: year.year });
  }
  return stops;
};

// A stop fills in over a few steps, and the next one starts a step later.
const stepMs = 90;
const steps = 4;

export const OnThisDay = ({ days }: OnThisDayProps) => {
  const data = use(days);
  const stops = data ? toStops(data.years) : [];
  // The origin is stop 0.
  const springs = useGrow(stops.length + 1, (index) => index * stepMs, {
    duration: stepMs * steps,
  });
  const grows = springs.map(({ grow }) => grow);

  if (data === undefined) {
    return <p>This day in past years is temporarily unavailable :(</p>;
  }

  const max = Math.max(0, ...data.years.map(({ count }) => count));

  return (
    <ol
      className="timeline"
      style={{ "--max": max, "--steps": steps } as CSSProperties}
    >
      <animated.li
        className="timeline-origin"
        style={{ "--grow": grows[0] } as CSSProperties}
      >
        {data.date}
      </animated.li>
      {stops.map((stop, index) => {
        const step = index + 1;
        return stop.kind === "played" ? (
          <animated.li
            key={stop.year.year}
            style={
              {
                "--grow": grows[step],
                "--value": stop.year.count,
              } as CSSProperties
            }
          >
            <span className="timeline-year">{stop.year.year}</span>
            <span className="timeline-top">
              {stop.year.top.track} &ndash; <em>{stop.year.top.artist}</em>
            </span>
            <span className="timeline-plays">
              <animated.span aria-hidden="true">
                {countUp(stop.year.count, grows[step], (shown) =>
                  formatPlays(stop.year.count, shown),
                )}
              </animated.span>
              <span className="visually-hidden">
                {formatPlays(stop.year.count)}
              </span>
            </span>
          </animated.li>
        ) : (
          <animated.li
            key={stop.to}
            style={{ "--grow": grows[step] } as CSSProperties}
            data-silent
          >
            <span className="timeline-year">
              {stop.from === stop.to ? stop.to : `${stop.from}–${stop.to}`}
            </span>
            <span className="timeline-top">nothing played</span>
          </animated.li>
        );
      })}
    </ol>
  );
};

const widths = [
  [14, 9],
  [19, 7],
  [11, 8],
  [16, 6],
] as const;

export const OnThisDaySkeleton = () => (
  <SkeletonStatus>
    <ol className="timeline placeholder" aria-hidden="true">
      <li className="timeline-origin">
        <Skeleton width={6} />
      </li>
      {widths.map(([top, count], index) => (
        <li key={index}>
          <span className="timeline-year">
            <Skeleton width={4} />
          </span>
          <span className="timeline-top">
            <Skeleton width={top} />
          </span>
          <span className="timeline-plays">
            <Skeleton width={count} />
          </span>
        </li>
      ))}
    </ol>
  </SkeletonStatus>
);
