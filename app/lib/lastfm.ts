import "server-only";
import { z } from "zod";

import { config } from "@/config";
import { env } from "@/lib/env";
import { getGlobal } from "@/lib/global";

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

const utsDateSchema = z
  .object({ uts: z.string() })
  .transform(({ uts }) => new Date(Number(uts) * 1000));

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
    date: utsDateSchema.optional(),
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

export type RecentTrack = z.infer<typeof recentTrackSchema>;

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

const lastfmUrlSchema = z
  .url({ protocol: /^https$/, hostname: /^www\.last\.fm$/ })
  .pipe(z.templateLiteral(["https://", z.string()]));

const albumPageResponseSchema = z
  .object({
    album: z.object({
      url: lastfmUrlSchema,
      image: coverSchema.catch(undefined),
    }),
  })
  .transform(({ album }) => ({ url: album.url, cover: album.image }));

export type AlbumInfo = z.infer<typeof albumPageResponseSchema>;

export async function albumGetInfo(
  artist: string,
  album: string,
): Promise<AlbumInfo> {
  return call("album.getinfo", albumPageResponseSchema, { artist, album });
}

// Last.fm writes a space as +, and takes any other encoding of a name.
const urlencode = (part: string) =>
  encodeURIComponent(part).replaceAll("%20", "+");

/** An album's page, for when Last.fm can't be asked for its own link. */
export const albumUrl = (artist: string, album: string) =>
  `https://www.last.fm/music/${urlencode(artist)}/${urlencode(album)}` as const;

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
  .transform((data) => {
    // The track playing now is listed whatever the range, without a date.
    const nowPlaying = data.recenttracks.track.find(
      (track) => track.playedAt === undefined,
    );
    return {
      total: data.recenttracks["@attr"].total,
      tracks: data.recenttracks.track.filter(
        (track): track is typeof track & { playedAt: Date } =>
          track.playedAt !== undefined,
      ),
      ...(nowPlaying && { nowPlaying }),
    };
  });

const rangeParams = ({ from, to }: { from: Date; to: Date }) => ({
  from: toUnixTime(from),
  // Last.fm leaves out the second `to` names, so ranges can meet on it.
  to: toUnixTime(to),
});

export async function userGetScrobbles(
  user: string,
  params: { from: Date; to: Date; limit: number; page?: number },
) {
  return call("user.getrecenttracks", userGetScrobblesResponseSchema, {
    user,
    limit: params.limit,
    page: params.page ?? 1,
    ...rangeParams(params),
  });
}

const userGetLovedTracksResponseSchema = z
  .object({
    lovedtracks: z.object({
      track: oneOrMany(
        z
          .object({
            name: z.string(),
            artist: z.object({ name: z.string() }),
            date: utsDateSchema,
          })
          .transform(({ name, artist, date }) => ({
            name,
            artist: artist.name,
            lovedAt: date,
          })),
      ),
      "@attr": z.object({ totalPages: z.string().transform(Number) }),
    }),
  })
  .transform(({ lovedtracks }) => ({
    totalPages: lovedtracks["@attr"].totalPages,
    tracks: lovedtracks.track,
  }));

export async function userGetLovedTracks(
  user: string,
  params: { limit: number; page: number },
) {
  return call("user.getlovedtracks", userGetLovedTracksResponseSchema, {
    user,
    ...params,
  });
}
