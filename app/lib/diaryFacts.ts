import "server-only";
import {
  addDays,
  clockTime,
  type Day,
  dayStart,
  fullDayLabel,
} from "@/lib/dates";
import { playCounts } from "@/lib/listeningQuery";
import { type Play, playsIn } from "@/lib/scrobbles";
import { query } from "@/lib/turso";

const TYPICAL_DAYS = 90;
const TOP = 5;
// Longer between two plays than a track lasts, so a pause ends a run.
const RUN_GAP_MS = 15 * 60_000;
const AWAY_MS = 365 * 24 * 60 * 60_000;

type Count = { plays: number };

export type DayFacts = {
  day: string;
  plays: number;
  /** The median plays a day over the days before. */
  typicalPlays: number;
  topArtists: ({ artist: string } & Count)[];
  /** Only tracks played more than once. */
  repeats: ({ artist: string; track: string } & Count)[];
  firstTimeArtists: ({ artist: string } & Count)[];
  returningArtists: ({ artist: string; lastPlayedBefore: Date } & Count)[];
  longestRun?: { from: Date; to: Date } & Count;
  /** Plays in each Stockholm hour played, against its daily average over the days before. */
  hours: { hour: string; plays: number; typical: number }[];
};

function ranked<T>(plays: Play[], key: (play: Play) => T & object) {
  const counts = new Map<string, T & Count>();
  for (const play of plays) {
    const value = key(play);
    const id = JSON.stringify(value);
    const count = counts.get(id) ?? { ...value, plays: 0 };
    count.plays++;
    counts.set(id, count);
  }
  // Ties keep first played first.
  return [...counts.values()].toSorted((a, b) => b.plays - a.plays);
}

function longestRun(plays: Play[]): DayFacts["longestRun"] {
  let longest: Play[] = [];
  let run: Play[] = [];
  for (const play of plays) {
    const last = run.at(-1);
    if (last && +play.playedAt - +last.playedAt > RUN_GAP_MS) run = [];
    run.push(play);
    if (run.length > longest.length) longest = run;
  }
  const [first] = longest;
  const last = longest.at(-1);
  return first && last && longest.length > 1
    ? { from: first.playedAt, to: last.playedAt, plays: longest.length }
    : undefined;
}

/** When each of the day's artists was first played, and last played before the day. */
async function artistHistory(from: Date, to: Date) {
  const { rows } = await query(
    `SELECT artist, MIN(played_at) AS first, MAX(CASE WHEN played_at < ? THEN played_at END) AS before
     FROM scrobbles
     WHERE played_at < ? AND artist IN (
       SELECT artist FROM scrobbles WHERE played_at >= ? AND played_at < ?
     )
     GROUP BY artist`,
    [from.getTime(), to.getTime(), from.getTime(), to.getTime()],
  );
  return new Map(
    rows.map((row) => [
      String(row["artist"]),
      {
        first: Number(row["first"]),
        before: row["before"] === null ? undefined : Number(row["before"]),
      },
    ]),
  );
}

const median = (values: number[]) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

/** What stood out in a Stockholm day's listening, for simon-bot's diary. */
export async function dayFacts(day: Day): Promise<DayFacts> {
  const from = dayStart(day);
  const to = dayStart(day, 1);
  const before = { from: dayStart(addDays(day, -TYPICAL_DAYS)), to: from };
  const [plays, history, days, hours] = await Promise.all([
    playsIn(from, to),
    artistHistory(from, to),
    playCounts(before, "day", "time", TYPICAL_DAYS),
    playCounts(before, "hour", "time", 24),
  ]);
  const typicalHour = new Map(
    hours.counts?.map(({ period, plays }) => [period, plays / TYPICAL_DAYS]),
  );
  const artists = ranked(plays, ({ artist }) => ({ artist }));
  const run = longestRun(plays);

  return {
    day: fullDayLabel(day),
    plays: plays.length,
    // Days without plays aren't counted, so they're the rest of the window.
    typicalPlays: median([
      ...(days.counts?.map(({ plays }) => plays) ?? []),
      ...Array<number>(TYPICAL_DAYS - (days.counts?.length ?? 0)).fill(0),
    ]),
    topArtists: artists.slice(0, TOP),
    repeats: ranked(plays, ({ artist, track }) => ({ artist, track }))
      .filter(({ plays }) => plays > 1)
      .slice(0, TOP),
    firstTimeArtists: artists.filter(
      ({ artist }) => (history.get(artist)?.first ?? 0) >= from.getTime(),
    ),
    returningArtists: artists.flatMap(({ artist, plays }) => {
      const last = history.get(artist)?.before;
      return last !== undefined && from.getTime() - last >= AWAY_MS
        ? [{ artist, plays, lastPlayedBefore: new Date(last) }]
        : [];
    }),
    ...(run && { longestRun: run }),
    hours: ranked(plays, ({ playedAt }) => ({
      hour: clockTime(playedAt).slice(11, 13),
    }))
      .toSorted((a, b) => a.hour.localeCompare(b.hour))
      .map(({ hour, plays }) => ({
        hour,
        plays,
        typical: Math.round((typicalHour.get(hour) ?? 0) * 10) / 10,
      })),
  };
}
