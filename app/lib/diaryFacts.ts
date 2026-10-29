import "server-only";
import { addDays, type Day, dayStart, fullDayLabel } from "@/lib/dates";
import { countsPer, top } from "@/lib/listeningQuery";
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
  repeats: ({ artist: string; track?: string | undefined } & Count)[];
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

/** The day's artists, most played first, with their first play and their last before the day. */
async function artists(from: Date, to: Date) {
  // Seeks on scrobbles_artist, so it reads a row or two per artist, not the history.
  const { rows } = await query(
    `SELECT a.artist, a.plays,
       (SELECT MIN(played_at) FROM scrobbles WHERE artist = a.artist) AS first,
       (SELECT MAX(played_at) FROM scrobbles WHERE artist = a.artist AND played_at < ?) AS before
     FROM (
       SELECT artist, COUNT(*) AS plays FROM scrobbles
       WHERE played_at >= ? AND played_at < ? GROUP BY artist
     ) a
     ORDER BY a.plays DESC, a.artist`,
    [from.getTime(), from.getTime(), to.getTime()],
  );
  return rows.map((row) => ({
    artist: String(row["artist"]),
    plays: Number(row["plays"]),
    first: Number(row["first"]),
    before: row["before"] === null ? undefined : Number(row["before"]),
  }));
}

/** What stood out in a Stockholm day's listening, for simon-bot's diary. */
export async function dayFacts(day: Day): Promise<DayFacts> {
  const span = { from: dayStart(day), to: dayStart(day, 1) };
  const before = { from: dayStart(addDays(day, -TYPICAL_DAYS)), to: span.from };
  const [plays, played, tracks, hours, days, typicalHours] = await Promise.all([
    playsIn(span.from, span.to),
    artists(span.from, span.to),
    top(span, "track", TOP),
    countsPer(span, "hour", "time", 24),
    countsPer(before, "day", "plays", TYPICAL_DAYS),
    countsPer(before, "hour", "time", 24),
  ]);
  const typicalHour = new Map(
    typicalHours.counts.map(({ period, plays }) => [
      period,
      plays / TYPICAL_DAYS,
    ]),
  );
  const run = longestRun(plays);

  return {
    day: fullDayLabel(day),
    plays: plays.length,
    // Busiest first, and days without plays aren't listed: past the list, the median is 0.
    typicalPlays: days.counts[TYPICAL_DAYS / 2 - 1]?.plays ?? 0,
    topArtists: played
      .slice(0, TOP)
      .map(({ artist, plays }) => ({ artist, plays })),
    repeats: tracks
      .filter(({ plays }) => plays > 1)
      .map(({ artist, track, plays }) => ({ artist, track, plays })),
    firstTimeArtists: played
      .filter(({ first }) => first >= span.from.getTime())
      .map(({ artist, plays }) => ({ artist, plays })),
    returningArtists: played.flatMap(({ artist, plays, before }) =>
      before !== undefined && span.from.getTime() - before >= AWAY_MS
        ? [{ artist, plays, lastPlayedBefore: new Date(before) }]
        : [],
    ),
    ...(run && { longestRun: run }),
    hours: hours.counts.map(({ period, plays }) => ({
      hour: period,
      plays,
      typical: Math.round((typicalHour.get(period) ?? 0) * 10) / 10,
    })),
  };
}
