"use server";

import { cacheLife, refresh } from "next/cache";
import { z } from "zod";

import { config } from "@/config";
import {
  artistGetUserPlays,
  type Period,
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
  type WeeklyArtist,
} from "@/lib/lastfm";
import { log } from "@/lib/log";
import {
  dateLabel,
  dayLabel,
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
      limit: 10,
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

export async function getScrobbles(
  period: Period,
): Promise<GetScrobblesResult> {
  "use cache";

  try {
    const now = new Date();
    const buckets =
      period === "overall"
        ? yearBuckets(config.lastfmSince, now)
        : scrobbleBuckets(period, now);
    const scrobbles = await Promise.all(
      buckets.map(async ({ label, from, to }) => ({
        label,
        // Only the total is read, so one track per page is enough.
        count: (
          await userGetScrobbles(config.lastfmUsername, { from, to, limit: 1 })
        ).total,
        current: to > now,
      })),
    );
    cacheLife("hours");
    return { status: "ok", scrobbles };
  } catch (err) {
    cacheLife("seconds");
    log.error({ err, action: "getScrobbles" }, "Error fetching scrobbles");
    return { status: "error", error: "Failed to fetch scrobbles" };
  }
}

export interface YearTopArtist {
  label: string;
  // Undefined for a year without scrobbles.
  artist: WeeklyArtist | undefined;
}

export type GetTopArtistByYearResult =
  | { status: "ok"; years: YearTopArtist[] }
  | { status: "error"; error: string };

export async function getTopArtistByYear(): Promise<GetTopArtistByYearResult> {
  "use cache";

  try {
    const years = await Promise.all(
      yearBuckets(config.lastfmSince, new Date()).map(
        async ({ label, from, to }) => ({
          label,
          artist: await userGetTopArtistInRange(config.lastfmUsername, {
            from,
            to,
          }),
        }),
      ),
    );
    cacheLife("hours");
    return { status: "ok", years };
  } catch (err) {
    cacheLife("seconds");
    log.error(
      { err, action: "getTopArtistByYear" },
      "Error fetching top artist by year",
    );
    return { status: "error", error: "Failed to fetch top artist by year" };
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
    cacheLife("hours");
    return { status: "ok", days: { date: dayLabel.format(now), years } };
  } catch (err) {
    cacheLife("seconds");
    log.error({ err, action: "getOnThisDay" }, "Error fetching on this day");
    return { status: "error", error: "Failed to fetch on this day" };
  }
}

export type GetArtistPlaysResult =
  | { status: "ok"; data: { name: string; plays: number } | null }
  | { status: "error"; error: string };

const ArtistSchema = z.string().trim().min(1).max(200);

export async function getArtistPlays(
  artist: string,
): Promise<GetArtistPlaysResult> {
  "use cache";

  try {
    const plays = await artistGetUserPlays(
      config.lastfmUsername,
      ArtistSchema.parse(artist),
    );
    cacheLife("minutes");
    return { status: "ok", data: plays ?? null };
  } catch (err) {
    cacheLife("seconds");
    log.error({ err, action: "getArtistPlays" }, "Error fetching artist plays");
    return { status: "error", error: "Failed to fetch plays" };
  }
}

const allTime = () => ({ from: new Date(0), to: new Date() });

async function getScrobbleTotal(): Promise<number> {
  "use cache";
  cacheLife("hours");
  const scrobbles = await userGetScrobbles(config.lastfmUsername, {
    ...allTime(),
    limit: 1,
  });
  return scrobbles.total;
}

export type ShuffledTrack = { name: string; artist: string; played: string };

export type GetRandomTrackResult =
  | { status: "ok"; data: ShuffledTrack }
  | { status: "error"; error: string };

export async function getRandomTrack(): Promise<GetRandomTrackResult> {
  try {
    const total = await getScrobbleTotal();
    // One track per page, so a page is a scrobble.
    const { tracks } = await userGetScrobbles(config.lastfmUsername, {
      ...allTime(),
      limit: 1,
      page: 1 + Math.floor(Math.random() * total),
    });
    const track = tracks[0];
    if (!track?.playedAt) throw new Error("No scrobble on the page");
    return {
      status: "ok",
      data: {
        name: track.name,
        artist: track.artist,
        played: dateLabel.format(track.playedAt),
      },
    };
  } catch (err) {
    log.error({ err, action: "getRandomTrack" }, "Error fetching random track");
    return { status: "error", error: "Failed to fetch a random track" };
  }
}
