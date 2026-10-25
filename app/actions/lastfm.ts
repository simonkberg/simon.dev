"use server";

import { cacheLife, refresh } from "next/cache";

import { config } from "@/config";
import {
  type ChartItem,
  type Period,
  TOP_ALBUMS,
  userGetRecentTracks,
  userGetScrobbles,
  userGetTopArtistInRange,
  type UserGetRecentTracksResponse,
  userGetTopAlbums,
  type UserGetTopAlbumsResponse,
  userGetTopArtists,
  type UserGetTopArtistsResponse,
  userGetTopTracks,
  type UserGetTopTracksResponse,
} from "@/lib/lastfm";
import { log } from "@/lib/log";
import {
  dayLabel,
  nextMidnight,
  sameDayBuckets,
  scrobbleBuckets,
  yearBuckets,
} from "@/lib/scrobbleBuckets";

export type RecentTrack = UserGetRecentTracksResponse[number];

export type GetRecentTracksResult =
  | { status: "ok"; tracks: RecentTrack[] }
  | { status: "error"; error: string };

export async function getRecentTracks(): Promise<GetRecentTracksResult> {
  "use cache";

  try {
    const tracks = await userGetRecentTracks(config.lastfmUsername, {
      limit: 5,
    });
    cacheLife("minutes");
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

export type TopTrack = UserGetTopTracksResponse[number];

export type GetTopTracksResult =
  | { status: "ok"; tracks: TopTrack[] }
  | { status: "error"; error: string };

export async function getTopTracks(
  period: Period,
): Promise<GetTopTracksResult> {
  "use cache";

  try {
    const tracks = await userGetTopTracks(config.lastfmUsername, {
      period,
      limit: 10,
    });
    cacheLife("hours");
    return { status: "ok", tracks };
  } catch (err) {
    cacheLife("seconds");
    log.error({ err, action: "getTopTracks" }, "Error fetching top tracks");
    return { status: "error", error: "Failed to fetch top tracks" };
  }
}

export type TopArtist = UserGetTopArtistsResponse[number];

export type GetTopArtistsResult =
  | { status: "ok"; artists: TopArtist[] }
  | { status: "error"; error: string };

export async function getTopArtists(
  period: Period,
): Promise<GetTopArtistsResult> {
  "use cache";

  try {
    const artists = await userGetTopArtists(config.lastfmUsername, {
      period,
      limit: 10,
    });
    cacheLife("hours");
    return { status: "ok", artists };
  } catch (err) {
    cacheLife("seconds");
    log.error({ err, action: "getTopArtists" }, "Error fetching top artists");
    return { status: "error", error: "Failed to fetch top artists" };
  }
}

export type TopAlbum = UserGetTopAlbumsResponse[number];

export type GetTopAlbumsResult =
  | { status: "ok"; albums: TopAlbum[] }
  | { status: "error"; error: string };

export async function getTopAlbums(
  period: Period,
): Promise<GetTopAlbumsResult> {
  "use cache";

  try {
    const albums = await userGetTopAlbums(config.lastfmUsername, {
      period,
      limit: TOP_ALBUMS,
    });
    cacheLife("hours");
    return { status: "ok", albums };
  } catch (err) {
    cacheLife("seconds");
    log.error({ err, action: "getTopAlbums" }, "Error fetching top albums");
    return { status: "error", error: "Failed to fetch top albums" };
  }
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
  period === "overall"
    ? yearBuckets(config.lastfmSince, now)
    : scrobbleBuckets(period, now);

// Regenerates once `end` passes, so a bar or day that has ended isn't shown as current.
function cacheUntil(end: Date, now: Date, maxSeconds: number) {
  const revalidate = Math.min(
    maxSeconds,
    Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 1000)),
  );
  cacheLife({ stale: 300, revalidate, expire: revalidate + 86_400 });
}

const countIn = async (from: Date, to: Date) =>
  // Only the total is read, so one track per page is enough.
  (await userGetScrobbles(config.lastfmUsername, { from, to, limit: 1 })).total;

const topArtistIn = (from: Date, to: Date) =>
  userGetTopArtistInRange(config.lastfmUsername, { from, to });

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

// An error thrown in a nested cache fails the prerender, so it's returned for the chart to throw.
async function settle<T>(request: () => Promise<T>): Promise<Settled<T>> {
  try {
    const value = await request();
    // An ended bar only changes by a late scrobble.
    cacheLife("days");
    return { ok: true, value };
  } catch (err) {
    cacheLife("seconds");
    return { ok: false, error: String(err) };
  }
}

function unwrap<T>(settled: Settled<T>): T {
  if (!settled.ok) throw new Error(settled.error);
  return settled.value;
}

async function endedCount(from: number, to: number) {
  "use cache";
  return settle(() => countIn(new Date(from), new Date(to)));
}

async function endedTopArtist(from: number, to: number) {
  "use cache";
  return settle(() => topArtistIn(new Date(from), new Date(to)));
}

export async function getScrobbles(
  period: Period,
): Promise<GetScrobblesResult> {
  "use cache";

  try {
    const now = new Date();
    const buckets = periodBuckets(period, now);
    const scrobbles = await Promise.all(
      buckets.map(async ({ label, from, to }) => {
        const current = to > now;
        const count = current
          ? await countIn(from, to)
          : unwrap(await endedCount(from.getTime(), to.getTime()));
        return { label, count, current };
      }),
    );
    cacheUntil(buckets.at(-1)?.to ?? now, now, 3600);
    return { status: "ok", scrobbles };
  } catch (err) {
    cacheLife("seconds");
    log.error({ err, action: "getScrobbles" }, "Error fetching scrobbles");
    return { status: "error", error: "Failed to fetch scrobbles" };
  }
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
      buckets.map(async ({ label, from, to }) => ({
        label,
        artist:
          to > now
            ? await topArtistIn(from, to)
            : unwrap(await endedTopArtist(from.getTime(), to.getTime())),
      })),
    );
    cacheUntil(buckets.at(-1)?.to ?? now, now, 3600);
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
export interface TopOfDay {
  artist: string;
  track: string;
}

export type PlayedYear = { year: string; count: number; top: TopOfDay };

export type DayInYear =
  | PlayedYear
  | { year: string; count: number; top?: never };

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

function topOfDay(tracks: readonly RecentTrack[]): TopOfDay | undefined {
  // Last.fm lists newest first.
  const played = tracks.toReversed();
  const artist = mostPlayed(played.map((track) => track.artist));
  const track = mostPlayed(
    played.filter((t) => t.artist === artist).map((t) => t.name),
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
      sameDayBuckets(config.lastfmSince, now).map(
        async ({ label, from, to }) => {
          // Last.fm's largest page; a busier day picks its top from the latest 200.
          const { total, tracks } = await userGetScrobbles(
            config.lastfmUsername,
            { from, to, limit: 200 },
          );
          return { year: label, count: total, top: topOfDay(tracks) };
        },
      ),
    );
    // Every year shown has ended, so only the date changing can change them.
    cacheUntil(nextMidnight(now), now, Infinity);
    return { status: "ok", days: { date: dayLabel.format(now), years } };
  } catch (err) {
    cacheLife("seconds");
    log.error({ err, action: "getOnThisDay" }, "Error fetching on this day");
    return { status: "error", error: "Failed to fetch on this day" };
  }
}
