"use client";

import { type CSSProperties, type Dispatch, use, useReducer } from "react";

import type { ScrobbleCount, BucketTopArtist } from "@/actions/listening";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { SkeletonStatus } from "@/components/Skeleton";
import { TooltipText } from "@/components/Tooltip";
import { formatNumber, formatPlays } from "@/lib/formatNumber";
import {
  type Lane,
  labelTick,
  lanes,
  type Run,
  stemStats,
} from "@/lib/scrobbleChart";

export interface ScrobbleChartProps {
  // Undefined when the counts failed to load.
  scrobbles: Promise<readonly ScrobbleCount[] | undefined>;
  // Undefined when the artists failed to load.
  topArtistByBucket: Promise<readonly BucketTopArtist[] | undefined>;
}

const Stems = ({
  items,
  active,
}: {
  items: readonly ScrobbleCount[];
  active: readonly Run[];
}) => {
  const { max, peak, average } = stemStats(items);

  return (
    <figure
      className="stems"
      style={
        {
          "--max": max,
          "--average": average,
          "--count": items.length,
        } as CSSProperties
      }
    >
      <ol>
        {items.map(({ label, count, current }, index) => {
          const text = `${label}: ${formatNumber(count)}${current ? " so far" : ""}`;
          const tick = labelTick(index, items.length);
          return (
            <li
              key={label}
              style={{ "--value": count, "--index": index } as CSSProperties}
              data-current={current || undefined}
              data-active={
                active.some(
                  ({ first, last }) => index >= first && index <= last,
                ) || undefined
              }
              data-tick={tick}
            >
              {/* A chart is pointed at on purpose, unlike text read past. */}
              <TooltipText tooltip={text} delay={0}>
                <span className="stem">
                  <span className="visually-hidden">{text}</span>
                </span>
              </TooltipText>
              {index === peak && (
                <span className="peak" aria-hidden="true">
                  <AnimatedNumber value={count} follow />
                </span>
              )}
              {tick && (
                <span className="tick" aria-hidden="true">
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {average !== undefined && (
        <span
          className="average"
          style={{ "--index": Math.floor(items.length / 2) } as CSSProperties}
          aria-hidden="true"
        >
          <span>
            <AnimatedNumber value={average} follow />
            <span className="average-label"> avg</span>
          </span>
        </span>
      )}
    </figure>
  );
};

type Pointing = { type: "enter"; runs: readonly Run[] } | { type: "leave" };

const NONE: readonly Run[] = [];

const Lanes = ({
  items,
  rows,
  point,
}: {
  items: readonly ScrobbleCount[];
  rows: readonly Lane[];
  point: Dispatch<Pointing>;
}) => (
  <div className="lanes" style={{ "--count": items.length } as CSSProperties}>
    {/* Cleared on leaving the lanes, not each row, so moving across re-renders once. */}
    <ol
      aria-label="Top artists"
      onPointerLeave={() => point({ type: "leave" })}
    >
      {rows.map(({ name, runs, plays, first, last }) => {
        const end = first > items.length / 2;
        const span = runs
          .map((run) => {
            const from = items[run.first]?.label;
            return run.first === run.last
              ? from
              : `${from}–${items[run.last]?.label}`;
          })
          .join(", ");
        const text = `${name}: ${formatPlays(plays)} in ${span}`;
        return (
          <li key={name} onPointerEnter={() => point({ type: "enter", runs })}>
            <div
              className="lane-label"
              style={
                {
                  gridColumn: end ? `1 / ${last + 2}` : `${first + 1} / -1`,
                  // Fades in under the bar's end it's aligned to.
                  "--column": end ? last : first,
                } as CSSProperties
              }
              data-end={end || undefined}
            >
              <span className="lane-name" aria-hidden="true">
                {name}
              </span>
              <span className="visually-hidden">{text}</span>
            </div>
            {runs.map((run) => (
              <span
                key={run.first}
                className="lane-run"
                style={
                  {
                    gridColumn: `${run.first + 1} / ${run.last + 2}`,
                    "--column": run.first,
                  } as CSSProperties
                }
                data-current={run.current || undefined}
              />
            ))}
          </li>
        );
      })}
    </ol>
  </div>
);

export const ScrobbleChart = ({
  scrobbles,
  topArtistByBucket,
}: ScrobbleChartProps) => {
  const items = use(scrobbles);
  const buckets = use(topArtistByBucket);
  // The runs of the lane under the pointer.
  const [active, point] = useReducer(
    (_: readonly Run[], action: Pointing) =>
      action.type === "enter" ? action.runs : NONE,
    NONE,
  );

  if (items === undefined) {
    return <p>Scrobbles are temporarily unavailable :(</p>;
  }

  const rows = buckets ? lanes(items, buckets) : [];

  return (
    <>
      <Stems items={items} active={active} />
      {rows.length > 0 && <Lanes items={items} rows={rows} point={point} />}
    </>
  );
};

export const ScrobbleChartSkeleton = () => (
  <SkeletonStatus>
    <figure className="stems" aria-hidden="true">
      <ol />
    </figure>
  </SkeletonStatus>
);
