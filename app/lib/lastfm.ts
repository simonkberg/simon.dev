import "server-only";
import { z } from "zod";

import { config } from "@/config";
import { env } from "@/lib/env";
import { getGlobal } from "@/lib/global";

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

const errorSchema = z.object({ error: z.number(), message: z.string() });

// A cold chart asks for every bar at once, and Last.fm asks for at most a few calls a second.
const MAX_IN_FLIGHT = 4;

/** Runs a call that fans out with others, at most a few at once, so single calls never queue behind them. */
export async function bulk<T>(request: () => Promise<T>): Promise<T> {
  const slots = getGlobal("lastfm-slots", () => ({
    inFlight: 0,
    waiting: [] as (() => void)[],
  }));
  if (slots.inFlight < MAX_IN_FLIGHT) slots.inFlight++;
  // A finished call hands its slot straight over, so a newcomer can't take it first.
  else await new Promise<void>((resolve) => slots.waiting.push(resolve));
  try {
    return await request();
  } finally {
    const next = slots.waiting.shift();
    if (next) next();
    else slots.inFlight--;
  }
}

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
  const json: unknown = await response.json().catch((err: unknown) => {
    if (response.ok) throw err;
  });
  const error = errorSchema.safeParse(json);
  // Last.fm's own message, like an unknown artist, says more than the status.
  if (error.success)
    throw new Error(
      `Last.fm API error ${error.data.error}: ${error.data.message}`,
    );
  if (!response.ok) {
    throw new Error(
      `Last.fm API error: ${response.status} ${response.statusText}`,
    );
  }

  return schema.parse(json);
}

const recentTrackSchema = z
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
  }));

const userGetRecentTracksResponseSchema = z
  .object({ recenttracks: z.object({ track: z.array(recentTrackSchema) }) })
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

// The listening page shows this many, as a #1 tile beside a 3×3 grid.
export const TOP_ALBUMS = 10;

// Last.fm serves this grey star for albums without art.
const PLACEHOLDER_COVER = "2a96cbd8b46e442fc41c2b86b821562f";

const coverSchema = z
  .array(z.object({ size: z.string(), "#text": z.string() }))
  .transform((images) => {
    const url = images.find(({ size }) => size === "extralarge")?.["#text"];
    // The original upload, without the size segment: Next resizes it, and never past its size.
    return url?.startsWith(config.lastfmCoverCdn) &&
      !url.includes(PLACEHOLDER_COVER)
      ? url.replace(/\/i\/u\/[^/]+\//, "/i/u/")
      : undefined;
  });

const userGetTopAlbumsResponseSchema = z
  .object({
    topalbums: z.object({
      album: z.array(
        z
          .object({
            name: z.string(),
            playcount: z.string().transform(Number),
            url: z
              .url({ protocol: /^https$/, hostname: /^www\.last\.fm$/ })
              .pipe(z.templateLiteral(["https://", z.string()])),
            artist: z.object({ name: z.string() }),
            // A cover is decoration: a malformed one leaves the tile empty, not the list unavailable.
            image: coverSchema.catch(undefined),
            "@attr": z.object({ rank: z.string().transform(Number) }),
          })
          .transform((data) => ({
            name: data.name,
            artist: data.artist.name,
            playcount: data.playcount,
            rank: data["@attr"].rank,
            url: data.url,
            cover: data.image,
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

const toUnixTime = (date: Date) => Math.floor(date.getTime() / 1000);

// A list of one comes back bare, not in an array.
const oneOrMany = <T extends z.ZodType>(item: T) =>
  z.union([z.array(item), item.transform((one) => [one])]);

const userGetScrobblesResponseSchema = z
  .object({
    recenttracks: z.object({
      track: oneOrMany(recentTrackSchema),
      "@attr": z.object({ total: z.string().transform(Number) }),
    }),
  })
  .transform((data) => ({
    total: data.recenttracks["@attr"].total,
    // The track playing now is listed whatever the range.
    tracks: data.recenttracks.track.filter((track) => !track.nowPlaying),
  }));

export type UserGetScrobblesResponse = z.infer<
  typeof userGetScrobblesResponseSchema
>;

const rangeParams = ({ from, to }: { from: Date; to: Date }) => ({
  from: toUnixTime(from),
  // `to` is inclusive, and the next range starts on this second.
  to: toUnixTime(to) - 1,
});

export async function userGetScrobbles(
  user: string,
  params: { from: Date; to: Date; limit: number },
): Promise<UserGetScrobblesResponse> {
  return call("user.getrecenttracks", userGetScrobblesResponseSchema, {
    user,
    limit: params.limit,
    ...rangeParams(params),
  });
}

const chartItemSchema = z
  .object({
    name: z.string(),
    playcount: z.string().transform(Number),
    // Tracks and albums only.
    artist: z.object({ "#text": z.string() }).optional(),
  })
  .transform(({ name, playcount, artist }) => ({
    name,
    ...(artist && { artist: artist["#text"] }),
    playcount,
  }));

export type ChartItem = z.infer<typeof chartItemSchema>;

const chartListSchema = oneOrMany(z.looseObject({}))
  // In case an empty range leaves the list out rather than sending [].
  .default([]);

export const chartKinds = ["artist", "track", "album"] as const;

export type ChartKind = (typeof chartKinds)[number];

const chartSchemas = {
  artist: z
    .object({ weeklyartistchart: z.object({ artist: chartListSchema }) })
    .transform((data) => data.weeklyartistchart.artist),
  track: z
    .object({ weeklytrackchart: z.object({ track: chartListSchema }) })
    .transform((data) => data.weeklytrackchart.track),
  album: z
    .object({ weeklyalbumchart: z.object({ album: chartListSchema }) })
    .transform((data) => data.weeklyalbumchart.album),
} satisfies Record<ChartKind, z.ZodType<unknown[]>>;

// The weekly charts take any range, not only the weeks Last.fm lists, ranked by plays.
export async function userGetChartInRange(
  user: string,
  kind: ChartKind,
  params: { from: Date; to: Date; limit: number },
): Promise<ChartItem[]> {
  const schema = chartSchemas[kind]
    // A year's chart lists thousands of items, so only those asked for are parsed.
    .transform((items) => items.slice(0, params.limit))
    .pipe(z.array(chartItemSchema));
  return call(`user.getweekly${kind}chart`, schema, {
    user,
    ...rangeParams(params),
  });
}

export async function userGetTopArtistInRange(
  user: string,
  params: { from: Date; to: Date },
): Promise<ChartItem | undefined> {
  const [top] = await userGetChartInRange(user, "artist", {
    ...params,
    limit: 1,
  });
  return top;
}

// Last.fm leaves the count out for an unknown user rather than failing.
const userPlaysSchema = z.coerce.number().optional();

const artistGetInfoResponseSchema = z
  .object({
    artist: z.object({
      name: z.string(),
      stats: z.object({ userplaycount: userPlaysSchema }),
    }),
  })
  .transform(({ artist }) => ({
    artist: artist.name,
    plays: artist.stats.userplaycount,
  }));

const trackGetInfoResponseSchema = z
  .object({
    track: z.object({
      name: z.string(),
      artist: z.object({ name: z.string() }),
      userplaycount: userPlaysSchema,
    }),
  })
  .transform(({ track }) => ({
    artist: track.artist.name,
    track: track.name,
    plays: track.userplaycount,
  }));

const albumGetInfoResponseSchema = z
  .object({
    album: z.object({
      name: z.string(),
      artist: z.string(),
      userplaycount: userPlaysSchema,
    }),
  })
  .transform(({ album }) => ({
    artist: album.artist,
    album: album.name,
    plays: album.userplaycount,
  }));

/** The user's plays of an artist, or of one of its tracks or albums, named as Last.fm spells them. */
export async function getUserPlays(
  user: string,
  params: { artist: string; track?: string; album?: string },
) {
  const query = { username: user, autocorrect: 1, ...params };
  if (params.track !== undefined) {
    return call("track.getinfo", trackGetInfoResponseSchema, query);
  }
  if (params.album !== undefined) {
    return call("album.getinfo", albumGetInfoResponseSchema, query);
  }
  return call("artist.getinfo", artistGetInfoResponseSchema, query);
}
