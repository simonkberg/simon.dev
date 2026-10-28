import { use } from "react";

import type { DayPlay } from "@/actions/listening";
import { SkeletonStatus } from "@/components/Skeleton";

export interface DayPlaysProps {
  // Undefined when the plays failed to load.
  plays: Promise<readonly DayPlay[] | undefined>;
}

export const DayPlays = ({ plays }: DayPlaysProps) => {
  const played = use(plays);

  if (played === undefined) {
    return <p>The day’s plays are temporarily unavailable :(</p>;
  }
  if (played.length === 0) return <p>Nothing played this day.</p>;

  return (
    <ol className="day-plays">
      {played.map(({ name, artist, time }, index) => (
        // Plays have no id, and a track can play twice a minute.
        <li key={index}>
          <time>{time}</time> {name} <span>{artist}</span>
        </li>
      ))}
    </ol>
  );
};

export const DayPlaysSkeleton = () => (
  <SkeletonStatus>
    <ol className="day-plays" aria-hidden="true" />
  </SkeletonStatus>
);
