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
  // The runs of buckets whose lane is hovered.
  active: readonly Run[];
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

interface Lane {
  name: string;
  runs: Run[];
  plays: number;
}

// One lane per top artist, in order of first appearance, with a run per stretch of its years.
const lanes = (items: readonly ScrobbleCount[]): Lane[] => {
  const byName = new Map<string, Lane>();
  items.forEach(({ topArtist }, index) => {
    if (!topArtist) return;
    const lane = byName.get(topArtist.name) ?? {
      name: topArtist.name,
      runs: [],
      plays: 0,
    };
    byName.set(topArtist.name, lane);
    lane.plays += topArtist.playcount;
    const run = lane.runs.at(-1);
    if (run?.last === index - 1) {
      run.last = index;
    } else {
      lane.runs.push({ first: index, last: index });
    }
  });
  return [...byName.values()];
};

const Lanes = ({
  items,
  onActive,
}: {
  items: readonly ScrobbleCount[];
  onActive: (runs: readonly Run[]) => void;
}) => (
  <div className="lanes" style={{ "--count": items.length } as CSSProperties}>
    {/* Cleared on leaving the lanes, not each row, so moving across re-renders once. */}
    <ol aria-label="Top artist by year" onPointerLeave={() => onActive([])}>
      {lanes(items).map(({ name, runs, plays }) => {
        const first = runs[0]?.first ?? 0;
        const last = runs.at(-1)?.last ?? 0;
        const end = first > items.length / 2;
        const years = runs
          .map((run) => {
            const from = items[run.first]?.label;
            return run.first === run.last
              ? from
              : `${from}–${items[run.last]?.label}`;
          })
          .join(", ");
        const text = `${name}: ${years}, ${formatNumber(plays)} plays`;
        return (
          <li key={name} onPointerEnter={() => onActive(runs)}>
            <div
              className="lane-label"
              style={{
                gridColumn: end ? `1 / ${last + 2}` : `${first + 1} / -1`,
              }}
              data-end={end || undefined}
            >
              <TooltipText tooltip={text} delay={0}>
                <span className="lane-name">
                  <span aria-hidden="true">{name}</span>
                  <span className="visually-hidden">{text}</span>
                </span>
              </TooltipText>
            </div>
            {runs.map((run) => (
              <span
                key={run.first}
                className="lane-run"
                style={{ gridColumn: `${run.first + 1} / ${run.last + 2}` }}
                data-current={items[run.last]?.current || undefined}
              />
            ))}
          </li>
        );
      })}
    </ol>
  </div>
);

const Chart = ({ items }: { items: readonly ScrobbleCount[] }) => {
  const [active, setActive] = useState<readonly Run[]>([]);

  return (
    <>
      <Stems items={items} active={active} />
      {items.some(({ topArtist }) => topArtist) && (
        <Lanes items={items} onActive={setActive} />
      )}
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
  </SkeletonStatus>
);
