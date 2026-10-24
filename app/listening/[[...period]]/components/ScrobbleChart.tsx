"use client";

import { animated, useSprings } from "@react-spring/web";
import { type CSSProperties, use, useState } from "react";

import type { ScrobbleCount } from "@/actions/lastfm";
import { SkeletonStatus } from "@/components/Skeleton";
import { TooltipText } from "@/components/Tooltip";
import { useMotion } from "@/components/useMotion";
import { formatNumber } from "@/lib/formatNumber";

export interface ScrobbleChartProps {
  // Undefined when the counts failed to load.
  scrobbles: Promise<readonly ScrobbleCount[] | undefined>;
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

const Stems = ({
  items,
  active,
}: {
  items: readonly ScrobbleCount[];
  // The run of buckets whose spine is hovered.
  active: Run | undefined;
}) => {
  const animate = useMotion();
  const [from] = useState(animate ? 0 : 1);
  const [springs] = useSprings(items.length, (index) => ({
    from: { grow: from },
    to: { grow: 1 },
    delay: index * 15,
  }));

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
                (active && index >= active.first && index <= active.last) ||
                undefined
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
                  {formatNumber(count)}
                </span>
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
        <span className="average" aria-hidden="true">
          <span>
            {formatNumber(average)}
            <span> avg</span>
          </span>
        </span>
      )}
    </figure>
  );
};

// Empty buckets stay apart from ones whose artist failed to load.
const shelfKey = ({ topArtist, count }: ScrobbleCount) =>
  topArtist?.name ?? count > 0;

// Neighbouring buckets with the same top artist share one spine.
const runs = (items: readonly ScrobbleCount[]): Run[] =>
  items.reduce<Run[]>((shelf, item, index) => {
    const run = shelf.at(-1);
    const previous = run && items[run.last];
    if (previous && shelfKey(previous) === shelfKey(item)) {
      run.last = index;
    } else {
      shelf.push({ first: index, last: index });
    }
    return shelf;
  }, []);

const Shelf = ({
  items,
  onActive,
}: {
  items: readonly ScrobbleCount[];
  onActive: (run: Run | undefined) => void;
}) => (
  <div className="shelf">
    {/* Cleared on leaving the shelf, not each spine, so gliding across re-renders once. */}
    <ol aria-label="Top artists" onPointerLeave={() => onActive(undefined)}>
      {runs(items).map((run) => {
        const span = items.slice(run.first, run.last + 1);
        const first = span[0];
        const last = span.at(-1);
        const name = first?.topArtist?.name;
        const plays = span.reduce(
          (sum, { topArtist }) => sum + (topArtist?.playcount ?? 0),
          0,
        );
        const range =
          first === last ? first?.label : `${first?.label}–${last?.label}`;
        const text = name
          ? `${range}: ${name}, ${formatNumber(plays)} plays${last?.current ? " so far" : ""}`
          : `${range}: ${first?.count ? "top artist unavailable" : "no scrobbles"}`;
        return (
          <li
            key={run.first}
            style={{ "--span": span.length } as CSSProperties}
            data-current={last?.current || undefined}
          >
            <TooltipText tooltip={text} delay={0}>
              <span className="spine" onPointerEnter={() => onActive(run)}>
                <span aria-hidden="true">{name}</span>
                <span className="visually-hidden">{text}</span>
              </span>
            </TooltipText>
          </li>
        );
      })}
    </ol>
    <span className="shelf-label" aria-hidden="true">
      top artist
    </span>
  </div>
);

const Chart = ({ items }: { items: readonly ScrobbleCount[] }) => {
  const [active, setActive] = useState<Run>();

  return (
    <>
      <Stems items={items} active={active} />
      <Shelf items={items} onActive={setActive} />
    </>
  );
};

export const ScrobbleChart = ({ scrobbles }: ScrobbleChartProps) => {
  const items = use(scrobbles);

  if (items === undefined) {
    return <p>Scrobbles are temporarily unavailable :(</p>;
  }

  return <Chart items={items} />;
};

export const ScrobbleChartSkeleton = () => (
  <SkeletonStatus>
    <figure className="stems" aria-hidden="true">
      <ol />
    </figure>
    <div className="shelf" aria-hidden="true">
      <ol />
    </div>
  </SkeletonStatus>
);
