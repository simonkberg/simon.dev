import type { DayPlay } from "@/actions/listening";

export interface DayPlaysProps {
  // Undefined when the plays failed to load.
  plays: readonly DayPlay[] | undefined;
}

export const DayPlays = ({ plays }: DayPlaysProps) => {
  if (plays === undefined) {
    return <p>The day’s plays are temporarily unavailable :(</p>;
  }
  if (plays.length === 0) return <p>Nothing played this day.</p>;

  return (
    <ol className="day-plays">
      {plays.map(({ name, artist, time }, index) => (
        // Plays have no id, and a track can play twice a minute.
        <li key={index}>
          <time>{time}</time> {name} <span>{artist}</span>
        </li>
      ))}
    </ol>
  );
};
