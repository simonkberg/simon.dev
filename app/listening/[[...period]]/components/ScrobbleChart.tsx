"use client";

import { animated, type SpringValue, useSprings } from "@react-spring/web";
import { type CSSProperties, use, useState } from "react";

import type { ScrobbleCount, BucketTopArtist } from "@/actions/lastfm";
import { SkeletonStatus } from "@/components/Skeleton";
import { TooltipText } from "@/components/Tooltip";
import { useMotion } from "@/components/useMotion";
import { formatNumber, formatPlays } from "@/lib/formatNumber";

export interface ScrobbleChartProps {
  // Undefined when the counts failed to load.
  scrobbles: Promise<readonly ScrobbleCount[] | undefined>;
  // Undefined when the artists failed to load.
  topArtistByBucket: Promise<readonly BucketTopArtist[] | undefined>;
}

// Labels count back from the current bucket. Narrow charts show every other one.
const labelStep = (count: number) => (count <= 8 ? 1 : Math.ceil(count / 6));

const labelTick = (fromEnd: number, step: number) => {
  if (fromEnd % (step * 2) === 0) return "narrow";
  if (fromEnd % step === 0) return "wide";
  return undefined;
};

interface Run {
  first: number;
  last: number;
}

// Grows in from nothing on the client; the server markup already shows the end state.
const useGrow = (count: number, delay: (index: number) => number) => {
  const animate = useMotion();
  const [from] = useState(animate ? 0 : 1);
  const [springs] = useSprings(count, (index) => ({
    from: { grow: from },
    to: { grow: 1 },
    delay: delay(index),
    config: { clamp: true },
  }));
  return springs;
};

const countUp = (value: number, grow: SpringValue<number> | undefined) =>
  grow?.to((g) => formatNumber(Math.round(value * g)));

const Stems = ({
  items,
  active,
}: {
  items: readonly ScrobbleCount[];
  active: readonly Run[];
}) => {
  const springs = useGrow(items.length, (index) => index * 15);
  // Rises with the middle stem.
  const averageGrow = springs[Math.floor(items.length / 2)];

  const counts = items.map(({ count }) => count);
  // All-zero counts would make the stems' `--value / --max` a 0/0.
  const max = Math.max(0, ...counts) || 1;
  const peak = counts.indexOf(max);
  // The current bucket is still filling up, so it would drag the average down.
  const settled = items.filter(({ current }) => !current);
  const average =
    settled.length > 0
      ? Math.round(
          settled.reduce((sum, { count }) => sum + count, 0) / settled.length,
        )
      : undefined;
  const step = labelStep(items.length);

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
          const tick = labelTick(items.length - 1 - index, step);
          return (
            <animated.li
              key={label}
              style={
                {
                  "--value": count,
                  "--grow": springs[index]?.grow,
                } as CSSProperties
              }
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
                <animated.span className="peak" aria-hidden="true">
                  {countUp(count, springs[index]?.grow)}
                </animated.span>
              )}
              {tick && (
                <span className="tick" aria-hidden="true">
                  {label}
                </span>
              )}
            </animated.li>
          );
        })}
      </ol>
      {average !== undefined && (
        <animated.span
          className="average"
          style={{ "--grow": averageGrow?.grow } as CSSProperties}
          aria-hidden="true"
        >
          <span>
            <animated.span>{countUp(average, averageGrow?.grow)}</animated.span>
            <span className="average-label"> avg</span>
          </span>
        </animated.span>
      )}
    </figure>
  );
};

interface Lane {
  name: string;
  runs: (Run & { current: boolean })[];
  plays: number;
  first: number;
  last: number;
}

const lanes = (
  items: readonly ScrobbleCount[],
  buckets: readonly BucketTopArtist[],
): Lane[] => {
  // By label, in case the two loads straddle a new bucket.
  const artistOf = new Map(buckets.map(({ label, artist }) => [label, artist]));
  const byName = new Map<string, Lane>();
  items.forEach(({ label, current }, index) => {
    const topArtist = artistOf.get(label);
    if (!topArtist) return;
    const lane = byName.get(topArtist.name) ?? {
      name: topArtist.name,
      runs: [],
      plays: 0,
      first: index,
      last: index,
    };
    byName.set(topArtist.name, lane);
    lane.plays += topArtist.playcount;
    lane.last = index;
    const run = lane.runs.at(-1);
    if (run?.last === index - 1) {
      run.last = index;
      run.current = current;
    } else {
      lane.runs.push({ first: index, last: index, current });
    }
  });
  return [...byName.values()];
};

const Lanes = ({
  items,
  rows,
  onActive,
}: {
  items: readonly ScrobbleCount[];
  rows: readonly Lane[];
  onActive: (runs: readonly Run[]) => void;
}) => {
  // One per column, so each bar starts sweeping out after the stem above its start.
  const springs = useGrow(items.length, (index) => 150 + index * 30);

  return (
    <div className="lanes" style={{ "--count": items.length } as CSSProperties}>
      {/* Cleared on leaving the lanes, not each row, so moving across re-renders once. */}
      <ol aria-label="Top artists" onPointerLeave={() => onActive([])}>
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
            <li key={name} onPointerEnter={() => onActive(runs)}>
              <animated.div
                className="lane-label"
                style={
                  {
                    gridColumn: end ? `1 / ${last + 2}` : `${first + 1} / -1`,
                    // Fades in under the bar's end it's aligned to.
                    "--grow": springs[end ? last : first]?.grow,
                  } as CSSProperties
                }
                data-end={end || undefined}
              >
                <span className="lane-name" aria-hidden="true">
                  {name}
                </span>
                <span className="visually-hidden">{text}</span>
              </animated.div>
              {runs.map((run) => (
                <animated.span
                  key={run.first}
                  className="lane-run"
                  style={
                    {
                      gridColumn: `${run.first + 1} / ${run.last + 2}`,
                      "--grow": springs[run.first]?.grow,
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
};

export const ScrobbleChart = ({
  scrobbles,
  topArtistByBucket,
}: ScrobbleChartProps) => {
  const items = use(scrobbles);
  const buckets = use(topArtistByBucket);
  const [active, setActive] = useState<readonly Run[]>([]);

  if (items === undefined) {
    return <p>Scrobbles are temporarily unavailable :(</p>;
  }

  const rows = buckets ? lanes(items, buckets) : [];

  return (
    <>
      <Stems items={items} active={active} />
      {rows.length > 0 && (
        <Lanes items={items} rows={rows} onActive={setActive} />
      )}
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
