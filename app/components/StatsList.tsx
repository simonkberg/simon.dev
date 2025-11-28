import { use } from "react";

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

  return (
    <ul>
      {result.stats.map((stat) => (
        <li key={stat.name}>
          {stat.name}: <AnimatedNumber value={stat.percent} decimals={2} />%
        </li>
      ))}
    </ul>
  );
};
