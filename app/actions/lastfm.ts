"use server";

import { cacheLife, refresh } from "next/cache";

import { config } from "@/config";
import {
  type Period,
  userGetRecentTracks,
  userGetScrobbleCount,
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
import { scrobbleBuckets, yearBuckets } from "@/lib/scrobbleBuckets";

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
  // Undefined when the bucket has no scrobbles or the artist failed to load.
  topArtist: { name: string; playcount: number } | undefined;
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
      buckets.map(async ({ label, from, to }) => {
        const [count, topArtist] = await Promise.all([
          userGetScrobbleCount(config.lastfmUsername, { from, to }),
          // The spines are a garnish: a failed one shouldn't take the counts with it.
          userGetTopArtistInRange(config.lastfmUsername, { from, to }).catch(
            (err: unknown) => {
              log.warn({ err, label }, "Error fetching top artist");
              return undefined;
            },
          ),
        ]);
        return { label, count, topArtist, current: to > now };
      }),
    );
    cacheLife("hours");
    return { status: "ok", scrobbles };
  } catch (err) {
    cacheLife("seconds");
    log.error({ err, action: "getScrobbles" }, "Error fetching scrobbles");
    return { status: "error", error: "Failed to fetch scrobbles" };
  }
}
