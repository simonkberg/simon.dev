import { type CSSProperties, use } from "react";

import type { DayInYear, OnThisDay as OnThisDayData } from "@/actions/lastfm";
import { Skeleton, SkeletonStatus } from "@/components/Skeleton";
import { formatPlays } from "@/lib/formatNumber";

export interface OnThisDayProps {
  // Undefined when the days failed to load.
  days: Promise<OnThisDayData | undefined>;
}

type Stop =
  | { kind: "played"; year: Required<DayInYear> }
  | { kind: "silent"; from: string; to: string };

// Years with nothing played fold into one quiet stretch of rail.
const toStops = (years: readonly DayInYear[]): Stop[] => {
  const stops: Stop[] = [];
  for (const { top, ...year } of years) {
    const last = stops.at(-1);
    if (top) stops.push({ kind: "played", year: { ...year, top } });
    else if (last?.kind === "silent") last.from = year.year;
    else stops.push({ kind: "silent", from: year.year, to: year.year });
  }
  return stops;
};

export const OnThisDay = ({ days }: OnThisDayProps) => {
  const data = use(days);

  if (data === undefined) {
    return <p>This day in past years is temporarily unavailable :(</p>;
  }

  const max = Math.max(0, ...data.years.map(({ count }) => count));

  return (
    <ol className="timeline" style={{ "--max": max } as CSSProperties}>
      <li className="timeline-origin">{data.date}</li>
      {toStops(data.years).map((stop) =>
        stop.kind === "played" ? (
          <li
            key={stop.year.year}
            style={{ "--value": stop.year.count } as CSSProperties}
          >
            <span className="timeline-year">{stop.year.year}</span>
            <span className="timeline-top">
              {stop.year.top.track} &ndash; <em>{stop.year.top.artist}</em>
            </span>
            <span className="timeline-plays">
              {formatPlays(stop.year.count)}
            </span>
          </li>
        ) : (
          <li key={stop.to} data-silent>
            <span className="timeline-year">
              {stop.from === stop.to ? stop.to : `${stop.from}–${stop.to}`}
            </span>
            <span className="timeline-top">nothing played</span>
          </li>
        ),
      )}
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
