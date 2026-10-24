import { http, HttpResponse, type JsonBodyType } from "msw";
import { describe, expect, it, vi } from "vitest";

import { coverCdn } from "@/mocks/lastfm";
import { server } from "@/mocks/node";

import {
  getUserPlays,
  userGetChartInRange,
  userGetRecentTracks,
  userGetScrobbles,
  userGetTopAlbums,
  userGetTopArtistInRange,
  userGetTopArtists,
  userGetTopTracks,
} from "./lastfm";

const LASTFM_BASE_URL = "https://ws.audioscrobbler.com/2.0/";

function lastfmReturns(body: JsonBodyType | Response) {
  let params: Record<string, string> = {};
  server.use(
    http.get(LASTFM_BASE_URL, ({ request }) => {
      params = Object.fromEntries(new URL(request.url).searchParams);
      return body instanceof Response ? body : HttpResponse.json(body);
    }),
  );
  return () => params;
}

const recentTrack = (name: string, extra: object = {}) => ({
  name,
  artist: { name: `${name} Artist` },
  album: { "#text": `${name} Album` },
  ...extra,
});

const nowPlaying = { "@attr": { nowplaying: "true" } };
const playedAt = (uts: string) => ({ date: { uts } });

describe("userGetRecentTracks", () => {
  it("should fetch and parse recent tracks successfully", async () => {
    const params = lastfmReturns({
      recenttracks: {
        track: [
          recentTrack("Test", { ...playedAt("1609459200"), loved: "1" }),
          {
            name: "Another",
            artist: { "#text": "Another Artist" },
            album: { "#text": "Another Album" },
            ...playedAt("1609372800"),
            loved: "0",
          },
        ],
      },
    });

    const tracks = await userGetRecentTracks("testuser");

    expect(params()).toMatchObject({
      method: "user.getrecenttracks",
      api_key: "test-last-fm-api-key",
      user: "testuser",
      extended: "1",
    });
    expect(tracks).toEqual([
      {
        name: "Test",
        artist: "Test Artist",
        album: "Test Album",
        playedAt: new Date(1609459200000),
        nowPlaying: false,
        loved: true,
      },
      {
        name: "Another",
        artist: "Another Artist",
        album: "Another Album",
        playedAt: new Date(1609372800000),
        nowPlaying: false,
        loved: false,
      },
    ]);
  });

  it("should handle now playing track", async () => {
    lastfmReturns({
      recenttracks: { track: [recentTrack("Now Playing", nowPlaying)] },
    });

    const tracks = await userGetRecentTracks("testuser");

    expect(tracks[0]?.nowPlaying).toBe(true);
    expect(tracks[0]?.playedAt).toBeUndefined();
  });

  it("should support limit and page parameters", async () => {
    const params = lastfmReturns({ recenttracks: { track: [] } });

    await userGetRecentTracks("testuser", { limit: 5, page: 2 });

    expect(params()).toMatchObject({ limit: "5", page: "2" });
  });

  it("should handle invalid response schema", async () => {
    lastfmReturns({ invalid: "data" });

    await expect(userGetRecentTracks("testuser")).rejects.toThrow();
  });

  it("should handle network errors", async () => {
    lastfmReturns(HttpResponse.error());

    await expect(userGetRecentTracks("testuser")).rejects.toThrow();
  });

  it("should configure fetch with 10 second timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    lastfmReturns({ recenttracks: { track: [] } });

    await userGetRecentTracks("testuser");

    expect(timeoutSpy).toHaveBeenCalledWith(10000);
  });

  it("should handle an HTTP error", async () => {
    lastfmReturns(
      new HttpResponse(null, {
        status: 503,
        statusText: "Service Unavailable",
      }),
    );

    await expect(userGetRecentTracks("testuser")).rejects.toThrow(
      "Last.fm API error: 503 Service Unavailable",
    );
  });

  it("should throw Last.fm's own error message", async () => {
    lastfmReturns(
      HttpResponse.json(
        { error: 6, message: "User not found" },
        { status: 404 },
      ),
    );

    await expect(userGetRecentTracks("nobody")).rejects.toThrow(
      "Last.fm API error 6: User not found",
    );
  });

  it("should throw a body that isn't JSON", async () => {
    lastfmReturns(new HttpResponse("<html>", { status: 200 }));

    await expect(userGetRecentTracks("testuser")).rejects.toThrow(SyntaxError);
  });

  it("should enforce limit when now playing track is returned", async () => {
    lastfmReturns({
      recenttracks: {
        track: [
          recentTrack("Now Playing", nowPlaying),
          recentTrack("Track 1", playedAt("1609459200")),
          recentTrack("Track 2", playedAt("1609372800")),
          recentTrack("Track 3", playedAt("1609286400")),
        ],
      },
    });

    const tracks = await userGetRecentTracks("testuser", { limit: 3 });

    expect(tracks.map((track) => track.name)).toEqual([
      "Now Playing",
      "Track 1",
      "Track 2",
    ]);
  });
});

describe("userGetTopTracks", () => {
  it("should fetch and parse top tracks successfully", async () => {
    const params = lastfmReturns({
      toptracks: {
        track: [
          {
            name: "Test Track",
            playcount: "100",
            artist: { name: "Test Artist" },
            "@attr": { rank: "1" },
          },
          {
            name: "Another Track",
            playcount: "50",
            artist: { name: "Another Artist" },
            "@attr": { rank: "2" },
          },
        ],
      },
    });

    const tracks = await userGetTopTracks("testuser", {
      period: "7day",
      limit: 10,
    });

    expect(params()).toMatchObject({
      method: "user.gettoptracks",
      api_key: "test-last-fm-api-key",
      user: "testuser",
      period: "7day",
      limit: "10",
    });
    expect(tracks).toEqual([
      { name: "Test Track", artist: "Test Artist", playcount: 100, rank: 1 },
      {
        name: "Another Track",
        artist: "Another Artist",
        playcount: 50,
        rank: 2,
      },
    ]);
  });
});

describe("userGetTopArtists", () => {
  it("should fetch and parse top artists successfully", async () => {
    const params = lastfmReturns({
      topartists: {
        artist: [
          { name: "Test Artist", playcount: "500", "@attr": { rank: "1" } },
          { name: "Another Artist", playcount: "300", "@attr": { rank: "2" } },
        ],
      },
    });

    const artists = await userGetTopArtists("testuser", {
      period: "1month",
      limit: 10,
    });

    expect(params()).toMatchObject({
      method: "user.gettopartists",
      user: "testuser",
      period: "1month",
      limit: "10",
    });
    expect(artists).toEqual([
      { name: "Test Artist", playcount: 500, rank: 1 },
      { name: "Another Artist", playcount: 300, rank: 2 },
    ]);
  });
});

describe("userGetTopAlbums", () => {
  const images = (hash: string, host = coverCdn) =>
    [
      ["small", "34s"],
      ["medium", "64s"],
      ["large", "174s"],
      ["extralarge", "300x300"],
    ].map(([size, path]) => ({
      size,
      "#text": hash && `${host}/${path}/${hash}.jpg`,
    }));
  const album = (
    name: string,
    rank: number,
    playcount: number,
    image?: object[],
  ) => ({
    name,
    playcount: String(playcount),
    url: `https://www.last.fm/music/${name}`,
    artist: { name: `${name} Artist` },
    image,
    "@attr": { rank: String(rank) },
  });

  it("should fetch and parse top albums successfully", async () => {
    const params = lastfmReturns({
      topalbums: {
        album: [
          album("Test", 1, 250, images("abc123")),
          album("Another", 2, 200),
        ],
      },
    });

    const albums = await userGetTopAlbums("testuser", {
      period: "3month",
      limit: 10,
    });

    expect(params()).toMatchObject({
      method: "user.gettopalbums",
      user: "testuser",
      period: "3month",
      limit: "10",
    });
    expect(albums).toEqual([
      {
        name: "Test",
        artist: "Test Artist",
        playcount: 250,
        rank: 1,
        url: "https://www.last.fm/music/Test",
        cover: `${coverCdn}/abc123.jpg`,
      },
      {
        name: "Another",
        artist: "Another Artist",
        playcount: 200,
        rank: 2,
        url: "https://www.last.fm/music/Another",
        cover: undefined,
      },
    ]);
  });

  it("should reject an album linking off Last.fm", async () => {
    lastfmReturns({
      topalbums: {
        album: [{ ...album("Test", 1, 250), url: "https://example.com/Test" }],
      },
    });

    await expect(
      userGetTopAlbums("testuser", { period: "3month", limit: 10 }),
    ).rejects.toThrow();
  });

  it.each([
    ["no art", ""],
    ["Last.fm's placeholder star", "2a96cbd8b46e442fc41c2b86b821562f"],
    ["another host", "abc123", "https://example.com/i/u"],
  ])("should leave out the cover for %s", async (_, hash, host?: string) => {
    lastfmReturns({
      topalbums: { album: [album("Test", 1, 250, images(hash, host))] },
    });

    const [first] = await userGetTopAlbums("testuser", {
      period: "3month",
      limit: 10,
    });

    expect(first?.cover).toBeUndefined();
  });
});

describe("userGetScrobbles", () => {
  it("should read the range's total and played tracks", async () => {
    const params = lastfmReturns({
      recenttracks: {
        track: [
          recentTrack("Now", nowPlaying),
          recentTrack("Test", playedAt("1609459200")),
        ],
        "@attr": { total: "1234" },
      },
    });

    const scrobbles = await userGetScrobbles("testuser", {
      from: new Date("2021-01-01T00:00:00Z"),
      to: new Date("2021-01-02T00:00:00Z"),
      limit: 1,
    });

    expect(params()).toMatchObject({
      method: "user.getrecenttracks",
      user: "testuser",
      limit: "1",
      from: "1609459200",
      to: "1609545599",
    });
    expect(scrobbles).toEqual({
      total: 1234,
      tracks: [expect.objectContaining({ name: "Test" })],
    });
  });

  it("should read a range with one scrobble, which Last.fm lists bare", async () => {
    lastfmReturns({
      recenttracks: {
        track: recentTrack("Test", playedAt("1609459200")),
        "@attr": { total: "1" },
      },
    });

    const scrobbles = await userGetScrobbles("testuser", {
      from: new Date("2021-01-01T00:00:00Z"),
      to: new Date("2021-01-02T00:00:00Z"),
      limit: 200,
    });

    expect(scrobbles.tracks).toEqual([
      expect.objectContaining({ name: "Test" }),
    ]);
  });
});

describe("userGetChartInRange", () => {
  it.each(["track", "album"] as const)(
    "should take the most played %ss in the range, up to the limit",
    async (kind) => {
      const params = lastfmReturns({
        [`weekly${kind}chart`]: {
          [kind]: ["Thursday", "Overcoat", "Gold"].map((name, i) => ({
            name,
            artist: { "#text": `${name} Artist` },
            playcount: String(9 - i),
            "@attr": { rank: String(i + 1) },
          })),
        },
      });

      const top = await userGetChartInRange("testuser", kind, {
        from: new Date("2021-01-01T00:00:00Z"),
        to: new Date("2021-01-02T00:00:00Z"),
        limit: 2,
      });

      expect(params()).toMatchObject({ method: `user.getweekly${kind}chart` });
      expect(top).toEqual([
        { name: "Thursday", artist: "Thursday Artist", playcount: 9 },
        { name: "Overcoat", artist: "Overcoat Artist", playcount: 8 },
      ]);
    },
  );
});

describe("userGetTopArtistInRange", () => {
  const range = {
    from: new Date("2021-01-01T00:00:00Z"),
    to: new Date("2021-01-02T00:00:00Z"),
  };
  const artist = (name: string, playcount: string) => ({
    name,
    playcount,
    "@attr": { rank: "1" },
  });

  it("should take the most played artist in the range", async () => {
    const params = lastfmReturns({
      weeklyartistchart: { artist: [artist("Smog", "23"), artist("Low", "4")] },
    });

    const top = await userGetTopArtistInRange("testuser", range);

    expect(params()).toMatchObject({
      method: "user.getweeklyartistchart",
      user: "testuser",
      from: "1609459200",
      to: "1609545599",
    });
    expect(top).toEqual({ name: "Smog", playcount: 23 });
  });

  it("should read a chart of one, which Last.fm lists bare", async () => {
    lastfmReturns({ weeklyartistchart: { artist: artist("Smog", "1") } });

    expect(await userGetTopArtistInRange("testuser", range)).toEqual({
      name: "Smog",
      playcount: 1,
    });
  });

  it("should find no artist in an empty range", async () => {
    lastfmReturns({ weeklyartistchart: {} });

    expect(await userGetTopArtistInRange("testuser", range)).toBeUndefined();
  });
});

describe("getUserPlays", () => {
  it("should count an artist's plays, as Last.fm spells the artist", async () => {
    const params = lastfmReturns({
      artist: { name: "Radiohead", stats: { userplaycount: "1234" } },
    });

    await expect(
      getUserPlays("testuser", { artist: "radiohed" }),
    ).resolves.toEqual({ artist: "Radiohead", plays: 1234 });
    expect(params()).toMatchObject({
      method: "artist.getinfo",
      artist: "radiohed",
      username: "testuser",
      autocorrect: "1",
    });
  });

  it("should count a track's plays", async () => {
    const params = lastfmReturns({
      track: {
        name: "Idioteque",
        artist: { name: "Radiohead" },
        userplaycount: "42",
      },
    });

    await expect(
      getUserPlays("testuser", { artist: "Radiohead", track: "idioteque" }),
    ).resolves.toEqual({ artist: "Radiohead", track: "Idioteque", plays: 42 });
    expect(params()).toMatchObject({
      method: "track.getinfo",
      artist: "Radiohead",
      track: "idioteque",
    });
  });

  it("should count an album's plays", async () => {
    const params = lastfmReturns({
      album: { name: "Kid A", artist: "Radiohead", userplaycount: 7 },
    });

    await expect(
      getUserPlays("testuser", { artist: "Radiohead", album: "kid a" }),
    ).resolves.toEqual({ artist: "Radiohead", album: "Kid A", plays: 7 });
    expect(params()).toMatchObject({ method: "album.getinfo", album: "kid a" });
  });

  it("should leave the plays out when Last.fm does", async () => {
    lastfmReturns({ artist: { name: "Radiohead", stats: {} } });

    await expect(
      getUserPlays("nobody", { artist: "Radiohead" }),
    ).resolves.toEqual({ artist: "Radiohead", plays: undefined });
  });
});
