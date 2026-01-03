import "server-only";

import { z } from "zod";

import { env } from "@/lib/env";

export const periods = [
  "7day",
  "1month",
  "3month",
  "6month",
  "12month",
  "overall",
] as const;

export type Period = (typeof periods)[number];

export const periodLabels = {
  "7day": "7 days",
  "1month": "1 month",
  "3month": "3 months",
  "6month": "6 months",
  "12month": "1 year",
  overall: "all time",
} as const satisfies Record<Period, string>;

export function isValidPeriod(value: unknown): value is Period {
  return periods.includes(value as Period);
}

const BASE_URL = "https://ws.audioscrobbler.com/2.0/";

async function call<T extends z.ZodType>(
  method: string,
  schema: T,
  params: Record<string, unknown> = {},
): Promise<z.infer<T>> {
  const url = new URL(BASE_URL);
  url.searchParams.set("method", method);
  url.searchParams.set("api_key", env.LAST_FM_API_KEY);
  url.searchParams.set("format", "json");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    throw new Error(
      `Last.fm API error: ${response.status} ${response.statusText}`,
    );
  }
  const json = await response.json();

  return schema.parse(json);
}

const userGetRecentTracksResponseSchema = z
  .object({
    recenttracks: z.object({
      track: z.array(
        z
          .object({
            name: z.string(),
            artist: z
              .union([
                z.object({ "#text": z.string() }),
                z.object({ name: z.string() }),
              ])
              .transform((artist) =>
                "name" in artist ? artist.name : artist["#text"],
              ),
            album: z
              .object({ "#text": z.string() })
              .transform((album) => album["#text"]),
            date: z
              .object({ uts: z.string() })
              .optional()
              .transform((data) =>
                data ? new Date(Number(data.uts) * 1000) : undefined,
              ),
            loved: z
              .union([z.literal("0"), z.literal("1")])
              .optional()
              .transform((val) => val === "1"),
            "@attr": z.object({ nowplaying: z.string() }).optional(),
          })
          .transform((data) => ({
            name: data.name,
            artist: data.artist,
            album: data.album,
            playedAt: data.date,
            nowPlaying: !!data["@attr"]?.nowplaying,
            loved: data.loved,
          })),
      ),
    }),
  })
  .transform((data) => data.recenttracks.track);

export type UserGetRecentTracksResponse = z.infer<
  typeof userGetRecentTracksResponseSchema
>;

export async function userGetRecentTracks(
  user: string,
  params?: { limit?: number; page?: number },
): Promise<UserGetRecentTracksResponse> {
  const tracks = await call(
    "user.getrecenttracks",
    userGetRecentTracksResponseSchema,
    { user, extended: 1, ...params },
  );

  // Last.fm doesn't count "now playing" track toward the limit, so enforce it
  if (params?.limit !== undefined && tracks.length > params.limit) {
    return tracks.slice(0, params.limit);
  }

  return tracks;
}

const userGetTopTracksResponseSchema = z
  .object({
    toptracks: z.object({
      track: z.array(
        z
          .object({
            name: z.string(),
            playcount: z.string().transform(Number),
            artist: z.object({ name: z.string() }),
            "@attr": z.object({ rank: z.string().transform(Number) }),
          })
          .transform((data) => ({
            name: data.name,
            artist: data.artist.name,
            playcount: data.playcount,
            rank: data["@attr"].rank,
          })),
      ),
    }),
  })
  .transform((data) => data.toptracks.track);

export type UserGetTopTracksResponse = z.infer<
  typeof userGetTopTracksResponseSchema
>;

export async function userGetTopTracks(
  user: string,
  params: { period: Period; limit: number },
): Promise<UserGetTopTracksResponse> {
  return call("user.gettoptracks", userGetTopTracksResponseSchema, {
    user,
    ...params,
  });
}

const userGetTopArtistsResponseSchema = z
  .object({
    topartists: z.object({
      artist: z.array(
        z
          .object({
            name: z.string(),
            playcount: z.string().transform(Number),
            "@attr": z.object({ rank: z.string().transform(Number) }),
          })
          .transform((data) => ({
            name: data.name,
            playcount: data.playcount,
            rank: data["@attr"].rank,
          })),
      ),
    }),
  })
  .transform((data) => data.topartists.artist);

export type UserGetTopArtistsResponse = z.infer<
  typeof userGetTopArtistsResponseSchema
>;

export async function userGetTopArtists(
  user: string,
  params: { period: Period; limit: number },
): Promise<UserGetTopArtistsResponse> {
  return call("user.gettopartists", userGetTopArtistsResponseSchema, {
    user,
    ...params,
  });
}

const userGetTopAlbumsResponseSchema = z
  .object({
    topalbums: z.object({
      album: z.array(
        z
          .object({
            name: z.string(),
            playcount: z.string().transform(Number),
            artist: z.object({ name: z.string() }),
            "@attr": z.object({ rank: z.string().transform(Number) }),
          })
          .transform((data) => ({
            name: data.name,
            artist: data.artist.name,
            playcount: data.playcount,
            rank: data["@attr"].rank,
          })),
      ),
    }),
  })
  .transform((data) => data.topalbums.album);

export type UserGetTopAlbumsResponse = z.infer<
  typeof userGetTopAlbumsResponseSchema
>;

export async function userGetTopAlbums(
  user: string,
  params: { period: Period; limit: number },
): Promise<UserGetTopAlbumsResponse> {
  return call("user.gettopalbums", userGetTopAlbumsResponseSchema, {
    user,
    ...params,
  });
}
