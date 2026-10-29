import "server-only";
import { addDays, type Day, dayStart, fullDayLabel } from "@/lib/dates";
import { playCounts, top } from "@/lib/listeningQuery";
import { type Play, playsIn } from "@/lib/scrobbles";
import { query } from "@/lib/turso";

const TYPICAL_DAYS = 90;
const TOP = 5;
// Every artist of a day: more than anyone plays in one.
const ALL = 1000;
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
  if (!first || !last || first === last) return undefined;
  return { from: first.playedAt, to: last.playedAt, plays: longest.length };
}

/** When each of the day's artists was first played, and last played before the day. */
async function artistHistory(from: Date, to: Date) {
  // Seeks on scrobbles_artist, so it reads a row or two per artist, not the history.
  const { rows } = await query(
    `SELECT a.artist,
       (SELECT MIN(played_at) FROM scrobbles WHERE artist = a.artist) AS first,
       (SELECT MAX(played_at) FROM scrobbles WHERE artist = a.artist AND played_at < ?) AS before
     FROM (SELECT DISTINCT artist FROM scrobbles WHERE played_at >= ? AND played_at < ?) a`,
    [from.getTime(), from.getTime(), to.getTime()],
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
  const span = { from: dayStart(day), to: dayStart(day, 1) };
  const before = { from: dayStart(addDays(day, -TYPICAL_DAYS)), to: span.from };
  const [plays, artists, tracks, hours, history, days, typicalHours] =
    await Promise.all([
      playsIn(span.from, span.to),
      top(span, "artist", ALL),
      top(span, "track", TOP),
      playCounts(span, "hour", "time", 24),
      artistHistory(span.from, span.to),
      playCounts(before, "day", "time", TYPICAL_DAYS),
      playCounts(before, "hour", "time", 24),
    ]);
  const typicalHour = new Map(
    typicalHours.counts?.map(({ period, plays }) => [
      period,
      plays / TYPICAL_DAYS,
    ]),
  );
  const run = longestRun(plays);

  return {
    day: fullDayLabel(day),
    plays: plays.length,
    // Days without plays aren't counted, so they're the rest of the window.
    typicalPlays: median([
      ...(days.counts?.map(({ plays }) => plays) ?? []),
      ...Array<number>(TYPICAL_DAYS - (days.counts?.length ?? 0)).fill(0),
    ]),
    topArtists: artists
      .slice(0, TOP)
      .map(({ artist, plays }) => ({ artist, plays })),
    repeats: tracks.flatMap(({ artist, track = "", plays }) =>
      plays > 1 ? [{ artist, track, plays }] : [],
    ),
    firstTimeArtists: artists.flatMap(({ artist, plays }) =>
      (history.get(artist)?.first ?? 0) >= span.from.getTime()
        ? [{ artist, plays }]
        : [],
    ),
    returningArtists: artists.flatMap(({ artist, plays }) => {
      const last = history.get(artist)?.before;
      return last !== undefined && span.from.getTime() - last >= AWAY_MS
        ? [{ artist, plays, lastPlayedBefore: new Date(last) }]
        : [];
    }),
    ...(run && { longestRun: run }),
    hours: (hours.counts ?? []).map(({ period, plays }) => ({
      hour: period,
      plays,
      typical: Math.round((typicalHour.get(period) ?? 0) * 10) / 10,
    })),
  };
}
