"use server";

import { cacheLife, refresh } from "next/cache";

import { cacheUntil } from "@/lib/cacheUntil";
import { TOP_ALBUMS } from "@/lib/covers";
import {
  clockTime,
  type Day,
  type Month,
  dayLabel,
  dayStart,
  firstOfMonth,
  inHistory,
  localDay,
  midnight,
  nextMidnight,
} from "@/lib/dates";
import { albumGetInfo, type AlbumInfo, albumUrl, bulk } from "@/lib/lastfm";
import { log } from "@/lib/log";
import { isValidPeriod, type Period } from "@/lib/periods";
import {
  type ScrobbleBucket,
  monthBuckets,
  monthDayBuckets,
  periodStart,
  sameDayBuckets,
  scrobbleBuckets,
  yearBuckets,
} from "@/lib/scrobbleBuckets";
import {
  type ChartItem,
  countScrobbles,
  LATE_MS,
  type Play,
  type Played,
  playsIn,
  recentPlays,
  type RecentTrack,
  topArtist,
  topArtists,
  topPlayed,
} from "@/lib/scrobbles";

export type GetRecentTracksResult =
  | { status: "ok"; tracks: RecentTrack[] }
  | { status: "error"; error: string };

export async function getRecentTracks(): Promise<GetRecentTracksResult> {
  "use cache";

  try {
    const tracks = await recentPlays(5);
    // A few rows from Turso, so it rereads often rather than add a minute to the sync's.
    cacheLife({ stale: 15, revalidate: 15, expire: 15 });
    return { status: "ok", tracks };
  } catch (err) {
    cacheLife("seconds");
    log.error(
      { err, action: "getRecentTracks" },
      "Error fetching recent tracks",
    );
    return { status: "error", error: "Failed to fetch recent tracks" };
  }
}

export async function refreshRecentTracks(): Promise<void> {
  refresh();
}

type Ranked<T> = T & { rank: number };

export type TopTrack = Ranked<Played>;

export type GetTopTracksResult =
  | { status: "ok"; tracks: TopTrack[] }
  | { status: "error"; error: string };

const TOP = 10;

function historyDay(value: string, now: Date): Day {
  const day = inHistory(value, localDay(now));
  if (day === undefined) throw new Error(`Not a day of the history: ${value}`);
  return day;
}

/** A period until now, or a calendar month as "YYYY-MM". */
export type Span = Period | Month;

/** What a span's top lists count: a period's chart until now, or the month from its first day of the history. */
function spanRange(span: Span, now: Date) {
  if (isValidPeriod(span)) {
    const from = span === "overall" ? new Date(0) : periodStart(span, now);
    return { from, to: now };
  }
  // Server actions take any string, and each one is its own cache entry.
  const day = historyDay(firstOfMonth(span), now);
  const first = new Date(day);
  const [year, month] = [first.getUTCFullYear(), first.getUTCMonth()];
  return { from: dayStart(day), to: midnight(year, month + 1, 1) };
}

// A list reads every play in its span, and Turso bills rows read, so the longer ones are read once a day.
function cacheTopList(span: Span, to: Date, now: Date) {
  if (cacheSettled(to.getTime(), now)) return;
  if (!isValidPeriod(span) || span === "7day" || span === "1month") {
    cacheLife("hours");
  } else cacheUntil(nextMidnight(now).getTime(), now);
}

async function topIn<T>(
  span: Span,
  top: (from: Date, to: Date) => Promise<T>,
): Promise<T> {
  const now = new Date();
  const { from, to } = spanRange(span, now);
  const result = await top(from, to);
  cacheTopList(span, to, now);
  return result;
}

const ranked = <T>(items: readonly T[]): Ranked<T>[] =>
  items.map((item, index) => ({ ...item, rank: index + 1 }));

export async function getTopTracks(span: Span): Promise<GetTopTracksResult> {
  "use cache";

  try {
    const tracks = ranked(
      await topIn(span, (from, to) => topPlayed("track", from, to, TOP)),
    );
    return { status: "ok", tracks };
  } catch (err) {
    cacheLife("seconds");
    log.error({ err, action: "getTopTracks" }, "Error fetching top tracks");
    return { status: "error", error: "Failed to fetch top tracks" };
  }
}

export type TopArtist = Ranked<ChartItem>;

export type GetTopArtistsResult =
  | { status: "ok"; artists: TopArtist[] }
  | { status: "error"; error: string };

export async function getTopArtists(span: Span): Promise<GetTopArtistsResult> {
  "use cache";

  try {
    const artists = ranked(
      await topIn(span, (from, to) => topArtists(from, to, TOP)),
    );
    return { status: "ok", artists };
  } catch (err) {
    cacheLife("seconds");
    log.error({ err, action: "getTopArtists" }, "Error fetching top artists");
    return { status: "error", error: "Failed to fetch top artists" };
  }
}

export type TopAlbum = Ranked<Played> & AlbumInfo;

export type GetTopAlbumsResult =
  | { status: "ok"; albums: TopAlbum[] }
  | { status: "error"; error: string };

// Last.fm alone knows an album's cover and page, and they rarely change.
async function getAlbumInfo(artist: string, album: string): Promise<AlbumInfo> {
  "use cache";

  try {
    const info = await bulk(() => albumGetInfo(artist, album));
    cacheLife("days");
    return info;
  } catch (err) {
    cacheLife("minutes");
    log.warn({ err, artist, album }, "Error fetching album info");
    return { url: albumUrl(artist, album), cover: undefined };
  }
}

// Cached apart from the covers, so one Last.fm can't describe retries without rereading the plays.
async function getTopAlbumPlays(span: Span): Promise<Played[] | undefined> {
  "use cache";

  try {
    return await topIn(span, (from, to) =>
      topPlayed("album", from, to, TOP_ALBUMS),
    );
  } catch (err) {
    cacheLife("seconds");
    log.error({ err, action: "getTopAlbums" }, "Error fetching top albums");
    return undefined;
  }
}

export async function getTopAlbums(span: Span): Promise<GetTopAlbumsResult> {
  "use cache";

  const top = await getTopAlbumPlays(span);
  if (!top) {
    // Next refuses a nested short cache under an outer one without its own.
    cacheLife("seconds");
    return { status: "error", error: "Failed to fetch top albums" };
  }
  // Lasts as long as the list and its covers do.
  const albums = await Promise.all(
    ranked(top).map(async (album) => ({
      ...album,
      ...(await getAlbumInfo(album.artist, album.name)),
    })),
  );
  return { status: "ok", albums };
}

export interface ScrobbleCount {
  label: string;
  count: number;
  // Still under way, so its count is partial.
  current: boolean;
}

export type GetScrobblesResult =
  | { status: "ok"; scrobbles: ScrobbleCount[] }
  | { status: "error"; error: string };

const periodBuckets = (period: Period, now: Date) =>
  period === "overall" ? yearBuckets(now) : scrobbleBuckets(period, now);

const chartEnd = (buckets: readonly { to: Date }[]) =>
  Math.max(...buckets.map(({ to }) => to.getTime()));

type Settled<T> =
  | { status: "ok"; data: T }
  | { status: "error"; error: string };

// An ended bar only changes by a late scrobble, and none arrive past LATE_MS.
function cacheEnded(end: number, now: Date) {
  if (end + LATE_MS <= now.getTime()) cacheLife("max");
  else cacheLife("days");
}

// An error thrown in a nested cache fails the prerender, so it's returned for the chart to throw.
async function settle<T>(
  request: () => Promise<T>,
  to: Date,
): Promise<Settled<T>> {
  try {
    const data = await request();
    cacheEnded(to.getTime(), new Date());
    return { status: "ok", data };
  } catch (err) {
    cacheLife("seconds");
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function endedCount(from: Date, to: Date) {
  "use cache";
  return settle(() => countScrobbles(from, to), to);
}

async function endedTopArtist(from: Date, to: Date) {
  "use cache";
  return settle(() => topArtist(from, to), to);
}

// A scrobble can land a while after its track, so a bar that just ended is still fetched with the chart.
const SETTLE_MS = 60 * 60 * 1000;

const hasSettled = (end: number, now: Date) => end + SETTLE_MS <= now.getTime();

/** Caches what ended at `end` once it has settled, and says whether it had. */
function cacheSettled(end: number, now: Date) {
  const settled = hasSettled(end, now);
  if (settled) cacheEnded(end, now);
  return settled;
}

async function inBucket<T>(
  { from, to }: { from: Date; to: Date },
  now: Date,
  fresh: (from: Date, to: Date) => Promise<T>,
  ended: (from: Date, to: Date) => Promise<Settled<T>>,
): Promise<T> {
  if (!hasSettled(to.getTime(), now)) return fresh(from, to);
  const settled = await ended(from, to);
  if (settled.status === "error") throw new Error(settled.error);
  return settled.data;
}

// A chart that has settled only changes by a late scrobble; one still under way regenerates as a bar ends.
function cacheChart(buckets: readonly { to: Date }[], now: Date) {
  const end = chartEnd(buckets);
  if (!cacheSettled(end, now))
    cacheUntil(end > now.getTime() ? end : end + SETTLE_MS, now, 3600);
}

async function countBuckets(
  bucketsAt: (now: Date) => readonly ScrobbleBucket[],
  action: string,
): Promise<GetScrobblesResult> {
  try {
    const now = new Date();
    const buckets = bucketsAt(now);
    const scrobbles = await Promise.all(
      buckets.map(async (bucket) => ({
        label: bucket.label,
        count: await inBucket(bucket, now, countScrobbles, endedCount),
        current: bucket.to > now,
      })),
    );
    cacheChart(buckets, now);
    return { status: "ok", scrobbles };
  } catch (err) {
    cacheLife("seconds");
    log.error({ err, action }, "Error fetching scrobbles");
    return { status: "error", error: "Failed to fetch scrobbles" };
  }
}

export async function getScrobbles(
  period: Period,
): Promise<GetScrobblesResult> {
  "use cache";
  return countBuckets((now) => periodBuckets(period, now), "getScrobbles");
}

/** Every month's scrobbles since the first. */
export async function getScrobbleMonths(): Promise<GetScrobblesResult> {
  "use cache";
  return countBuckets(monthBuckets, "getScrobbleMonths");
}

/** The scrobbles on each day of a "YYYY-MM" month, up to today. */
export async function getDailyScrobbles(
  month: Month,
): Promise<GetScrobblesResult> {
  "use cache";
  return countBuckets(
    // Server actions take any string, and each one is its own cache entry.
    (now) => monthDayBuckets(historyDay(firstOfMonth(month), now), now),
    "getDailyScrobbles",
  );
}

export interface BucketTopArtist {
  label: string;
  // Undefined for a bucket without scrobbles.
  artist: ChartItem | undefined;
}

export type GetTopArtistByBucketResult =
  | { status: "ok"; buckets: BucketTopArtist[] }
  | { status: "error"; error: string };

export async function getTopArtistByBucket(
  period: Period,
): Promise<GetTopArtistByBucketResult> {
  "use cache";

  try {
    const now = new Date();
    const buckets = periodBuckets(period, now);
    const artists = await Promise.all(
      buckets.map(async (bucket) => ({
        label: bucket.label,
        artist: await inBucket(bucket, now, topArtist, endedTopArtist),
      })),
    );
    cacheChart(buckets, now);
    return { status: "ok", buckets: artists };
  } catch (err) {
    cacheLife("seconds");
    log.error(
      { err, action: "getTopArtistByBucket", period },
      "Error fetching top artist by bucket",
    );
    return { status: "error", error: "Failed to fetch top artist by bucket" };
  }
}

// The day's most played artist and their most played track, earliest first on ties.
export type TopOfDay = Pick<Play, "artist" | "track">;

export type DayInYear = { year: string; day: Day; count: number } & (
  | { top: TopOfDay }
  | { top?: never }
);

export type PlayedYear = Extract<DayInYear, { top: TopOfDay }>;

export interface OnThisDay {
  date: string;
  // Newest first.
  years: DayInYear[];
}

export type GetOnThisDayResult =
  | { status: "ok"; days: OnThisDay }
  | { status: "error"; error: string };

function mostPlayed(items: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  // A map keeps first-seen order and sorting is stable, so ties go to the earliest.
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function topOfDay(played: readonly Play[]): TopOfDay | undefined {
  const artist = mostPlayed(played.map((play) => play.artist));
  const track = mostPlayed(
    played.filter((play) => play.artist === artist).map((play) => play.track),
  );
  return artist === undefined || track === undefined
    ? undefined
    : { artist, track };
}

export async function getOnThisDay(): Promise<GetOnThisDayResult> {
  "use cache";

  try {
    const now = new Date();
    const years = await Promise.all(
      sameDayBuckets(now).map(async ({ label, from, to }) => {
        const played = await playsIn(from, to);
        return {
          year: label,
          day: localDay(from),
          count: played.length,
          top: topOfDay(played),
        };
      }),
    );
    // Every year shown has ended, so only the date changing can change them.
    cacheUntil(nextMidnight(now).getTime(), now);
    return { status: "ok", days: { date: dayLabel.format(now), years } };
  } catch (err) {
    cacheLife("seconds");
    log.error({ err, action: "getOnThisDay" }, "Error fetching on this day");
    return { status: "error", error: "Failed to fetch on this day" };
  }
}

export type DayPlay = {
  name: string;
  artist: string;
  // Stockholm's wall clock, like "16:27".
  time: string;
};

export type GetDayPlaysResult =
  | { status: "ok"; plays: DayPlay[] }
  | { status: "error"; error: string };

/** What played on a "YYYY-MM-DD" Stockholm date, oldest first. */
export async function getDayPlays(date: Day): Promise<GetDayPlaysResult> {
  "use cache";

  try {
    const now = new Date();
    const to = dayStart(historyDay(date, now), 1);
    const played = await playsIn(dayStart(date), to);
    if (!cacheSettled(to.getTime(), now)) cacheLife("minutes");
    return {
      status: "ok",
      plays: played.map(({ track, artist, playedAt }) => ({
        name: track,
        artist,
        time: clockTime(playedAt).slice(11),
      })),
    };
  } catch (err) {
    cacheLife("seconds");
    log.error({ err, action: "getDayPlays", date }, "Error fetching day plays");
    return { status: "error", error: "Failed to fetch the day's plays" };
  }
}
