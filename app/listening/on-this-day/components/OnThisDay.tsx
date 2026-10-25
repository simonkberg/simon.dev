"use client";

import { animated, easings, useSpring } from "@react-spring/web";
import { type CSSProperties, use, useState } from "react";

import type {
  DayInYear,
  OnThisDay as OnThisDayData,
  PlayedYear,
} from "@/actions/lastfm";
import { Skeleton, SkeletonStatus } from "@/components/Skeleton";
import { useMotion } from "@/components/useMotion";
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

// The rail draws down one stop per step; each stop fills in over the next few.
const stepMs = 90;
const fillSteps = 4;

const clamp = (value: number) => Math.min(Math.max(value, 0), 1);

// Draws in from the origin on the client; the server markup already shows the end state.
const useReveal = (stops: number) => {
  const animate = useMotion();
  const end = stops + fillSteps;
  const [from] = useState(animate ? 0 : end);
  const { progress } = useSpring({
    from: { progress: from },
    to: { progress: end },
    config: { duration: (end - from) * stepMs, easing: easings.linear },
  });
  const fill = (step: number) =>
    progress.to((p) => 1 - (1 - clamp((p - step) / fillSteps)) ** 2);
  return {
    fill,
    style: (step: number) =>
      ({
        "--rail": progress.to((p) => clamp(p - step)),
        "--fill": fill(step),
      }) as CSSProperties,
  };
};

export const OnThisDay = ({ days }: OnThisDayProps) => {
  const data = use(days);
  const stops = data ? toStops(data.years) : [];
  const reveal = useReveal(stops.length);

  if (data === undefined) {
    return <p>This day in past years is temporarily unavailable :(</p>;
  }

  const max = Math.max(0, ...data.years.map(({ count }) => count));

  return (
    <ol className="timeline" style={{ "--max": max } as CSSProperties}>
      <animated.li className="timeline-origin" style={reveal.style(0)}>
        {data.date}
      </animated.li>
      {stops.map((stop, index) => {
        const step = index + 1;
        return stop.kind === "played" ? (
          <animated.li
            key={stop.year.year}
            style={
              {
                ...reveal.style(step),
                "--value": stop.year.count,
              } as CSSProperties
            }
          >
            <span className="timeline-year">{stop.year.year}</span>
            <span className="timeline-top">
              {stop.year.top.track} &ndash; <em>{stop.year.top.artist}</em>
            </span>
            <animated.span className="timeline-plays">
              {reveal
                .fill(step)
                .to((f) => formatPlays(Math.round(stop.year.count * f)))}
            </animated.span>
          </animated.li>
        ) : (
          <animated.li key={stop.to} style={reveal.style(step)} data-silent>
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
