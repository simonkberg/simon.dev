import { type CSSProperties, use } from "react";

import type { WakaTimeStatsResult } from "@/actions/wakaTime";

import { AnimatedNumber } from "./AnimatedNumber";

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

  const max = Math.max(...result.stats.map((stat) => stat.percent));

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
