import { type CSSProperties, use } from "react";

import type { WakaTimeStatsResult } from "@/actions/wakaTime";

import { AnimatedNumber } from "./AnimatedNumber";
import { Skeleton, SkeletonStatus } from "./Skeleton";

export interface StatsListProps {
  stats: Promise<WakaTimeStatsResult>;
}

export const StatsList = ({ stats }: StatsListProps) => {
  const result = use(stats);

  if (result.status === "error") {
    return <p>Language statistics are temporarily unavailable :(</p>;
  }

  if (result.stats.length === 0) {
    return (
      <p>
        Oops! Looks like the language statistics are currently empty. I&apos;m
        probably on vacation 🌴 (or something is broken).
      </p>
    );
  }

  // All-zero stats would make the bars' `--value / --max` a 0/0.
  const max = Math.max(...result.stats.map((stat) => stat.percent)) || 1;

  return (
    <ul className="stats" style={{ "--max": max } as CSSProperties}>
      {result.stats.map((stat) => (
        <li
          key={stat.name}
          style={{ "--value": stat.percent } as CSSProperties}
        >
          <span className="label">{stat.name}</span>{" "}
          <span className="value">
            <AnimatedNumber value={stat.percent} decimals={2} />%
          </span>
        </li>
      ))}
    </ul>
  );
};

const labelWidths = [8, 6, 10, 5, 4, 7, 9, 6, 5, 4, 6, 4, 5, 4, 8] as const;

export const StatsListSkeleton = () => (
  <SkeletonStatus>
    <ul className="stats placeholder" aria-hidden="true">
      {labelWidths.map((width, index) => (
        <li key={index}>
          <span className="label">
            <Skeleton width={width} />
          </span>{" "}
          <span className="value">
            <Skeleton width={6} />
          </span>
        </li>
      ))}
    </ul>
  </SkeletonStatus>
);
