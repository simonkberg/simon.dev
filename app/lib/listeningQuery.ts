import "server-only";
import { likeContains } from "@/lib/sql";
import { query, type Value } from "@/lib/turso";

export type Filters = {
  from?: Date | undefined;
  to?: Date | undefined;
  artist?: string | undefined;
  track?: string | undefined;
  album?: string | undefined;
  loved?: boolean | undefined;
};

const LOVED_JOIN =
  "LEFT JOIN loved l ON l.artist = s.artist AND l.track = s.track";

/** The FROM and WHERE clauses for the matching plays, joining `loved` only when it is read. */
function matching(
  filters: Filters,
  { joinLoved = false, conditions = [] as string[] } = {},
): { sql: string; args: Value[] } {
  const where = [...conditions];
  const args: Value[] = [];
  if (filters.from !== undefined) {
    where.push("s.played_at >= ?");
    args.push(filters.from.getTime());
  }
  if (filters.to !== undefined) {
    where.push("s.played_at < ?");
    args.push(filters.to.getTime());
  }
  for (const column of ["artist", "track", "album"] as const) {
    const text = filters[column];
    if (text === undefined) continue;
    // LIKE ignores case, though only for ASCII letters.
    where.push(`s.${column} LIKE ? ESCAPE '\\'`);
    args.push(likeContains(text));
  }
  if (filters.loved !== undefined) {
    where.push(`l.track IS ${filters.loved ? "NOT NULL" : "NULL"}`);
  }
  const join = joinLoved || filters.loved !== undefined ? ` ${LOVED_JOIN}` : "";
  return {
    sql: `FROM scrobbles s${join}${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""}`,
    args,
  };
}

const seconds = "s.played_at / 1000";
const utc = `datetime(${seconds}, 'unixepoch')`;
const year = `strftime('%Y', ${seconds}, 'unixepoch')`;
// Summer time runs from 01:00 UTC on the last Sundays of March and October.
const summerFrom = `datetime(date(${year} || '-03-25', 'weekday 0'), '+1 hour')`;
const summerTo = `datetime(date(${year} || '-10-25', 'weekday 0'), '+1 hour')`;
// A play's Stockholm time, as SQLite knows no time zones.
const LOCAL_TIME = `datetime(${seconds}, 'unixepoch', CASE WHEN ${utc} >= ${summerFrom} AND ${utc} < ${summerTo} THEN '+2 hours' ELSE '+1 hour' END)`;

type Play = {
  name: string;
  artist: string;
  album: string;
  playedAt: Date;
  loved: boolean;
};

/** How many plays match, and the newest or oldest `limit` of them. */
export async function plays(
  filters: Filters,
  order: "newest" | "oldest",
  limit: number,
): Promise<{ total: number; plays: Play[] }> {
  const { sql, args } = matching(filters, { joinLoved: true });
  const direction = order === "newest" ? "DESC" : "ASC";
  const { rows } = await query(
    // The total is counted before the limit, so it counts every match.
    `SELECT s.played_at, s.artist, s.track, s.album, l.track IS NOT NULL AS loved,
       COUNT(*) OVER () AS total
     ${sql} ORDER BY s.played_at ${direction} LIMIT ?`,
    [...args, limit],
  );
  return {
    total: Number(rows[0]?.["total"] ?? 0),
    plays: rows.map((row) => ({
      name: String(row["track"]),
      artist: String(row["artist"]),
      album: String(row["album"]),
      playedAt: new Date(Number(row["played_at"])),
      loved: Boolean(row["loved"]),
    })),
  };
}

const groups = {
  artist: { by: "s.artist", conditions: [] },
  track: { by: "s.artist, s.track", conditions: [] },
  // Last.fm leaves a play's album empty when it has none, and ranks no such album.
  album: { by: "s.artist, s.album", conditions: ["s.album != ''"] },
} as const;

export type Group = keyof typeof groups;

type Top = {
  artist: string;
  track?: string;
  album?: string;
  plays: number;
  firstPlayed: Date;
  lastPlayed: Date;
};

/** The most played artists, tracks or albums among the matching plays, ties by artist, then title. */
export async function top(
  filters: Filters,
  group: Group,
  limit: number,
): Promise<Top[]> {
  const { by, conditions } = groups[group];
  const { sql, args } = matching(filters, { conditions: [...conditions] });
  const { rows } = await query(
    `SELECT ${by}, COUNT(*) AS plays, MIN(s.played_at) AS first, MAX(s.played_at) AS last
     ${sql} GROUP BY ${by} ORDER BY plays DESC, ${by} LIMIT ?`,
    [...args, limit],
  );
  return rows.map((row) => ({
    artist: String(row["artist"]),
    ...(group === "track" && { track: String(row["track"]) }),
    ...(group === "album" && { album: String(row["album"]) }),
    plays: Number(row["plays"]),
    firstPlayed: new Date(Number(row["first"])),
    lastPlayed: new Date(Number(row["last"])),
  }));
}

const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const weekday = `strftime('%w', ${LOCAL_TIME})`;

type Per = "hour" | "weekday" | "day" | "week" | "month" | "year";

const periods: Record<Per, { key: string; name?: string; sort?: string }> = {
  hour: { key: `strftime('%H', ${LOCAL_TIME})` },
  weekday: {
    key: weekday,
    name: `CASE ${weekday} ${weekdays.map((day, i) => `WHEN '${i}' THEN '${day}'`).join(" ")} END`,
    // Monday first.
    sort: "(key + 6) % 7",
  },
  day: { key: `date(${LOCAL_TIME})` },
  // The Monday the week starts on.
  week: { key: `date(${LOCAL_TIME}, '-6 days', 'weekday 1')` },
  month: { key: `strftime('%Y-%m', ${LOCAL_TIME})` },
  year: { key: `strftime('%Y', ${LOCAL_TIME})` },
};

/** How many plays match, in all or per Stockholm hour, weekday, day, week, month or year. */
export async function playCounts(
  filters: Filters,
  per: Per | undefined,
  order: "time" | "plays",
  limit: number,
): Promise<{
  total: number;
  counts?: { period: string; plays: number }[];
  truncated?: boolean;
}> {
  const { sql, args } = matching(filters);
  if (per === undefined) {
    const { rows } = await query(`SELECT COUNT(*) AS total ${sql}`, args);
    return { total: Number(rows[0]?.["total"]) };
  }
  const { key, name = key, sort = "key" } = periods[per];
  const { rows } = await query(
    // The total is summed before the limit, so it counts every period.
    `SELECT ${key} AS key, ${name} AS name, COUNT(*) AS plays, SUM(COUNT(*)) OVER () AS total ${sql}
     GROUP BY key ORDER BY ${order === "plays" ? "plays DESC, " : ""}${sort} LIMIT ?`,
    // One more than asked, to tell whether there are more.
    [...args, limit + 1],
  );
  const counts = rows.map((row) => ({
    period: String(row["name"]),
    plays: Number(row["plays"]),
  }));
  return {
    total: Number(rows[0]?.["total"] ?? 0),
    counts: counts.slice(0, limit),
    ...(counts.length > limit && { truncated: true }),
  };
}
