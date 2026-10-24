import { http, HttpResponse, type JsonBodyType } from "msw";
import { describe, expect, it, vi } from "vitest";

import { server } from "@/mocks/node";

import {
  userGetRecentTracks,
  userGetScrobbleCount,
  userGetTopAlbums,
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
  const cdn = "https://lastfm.freetls.fastly.net/i/u";
  const images = (hash: string) =>
    [
      ["small", "34s"],
      ["medium", "64s"],
      ["large", "174s"],
      ["extralarge", "300x300"],
    ].map(([size, path]) => ({
      size,
      "#text": hash && `${cdn}/${path}/${hash}.jpg`,
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
        cover: `${cdn}/300x300/abc123.jpg`,
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

  it.each([
    ["no art", ""],
    ["Last.fm's placeholder star", "2a96cbd8b46e442fc41c2b86b821562f"],
  ])("should leave out the cover for %s", async (_, hash) => {
    lastfmReturns({
      topalbums: { album: [album("Test", 1, 250, images(hash))] },
    });

    const [first] = await userGetTopAlbums("testuser", {
      period: "3month",
      limit: 10,
    });

    expect(first?.cover).toBeUndefined();
  });

  it("should leave out a malformed cover without failing the list", async () => {
    lastfmReturns({
      topalbums: { album: [album("Test", 1, 250, [{ size: "extralarge" }])] },
    });

    const [first] = await userGetTopAlbums("testuser", {
      period: "3month",
      limit: 10,
    });

    expect(first).toMatchObject({ name: "Test", cover: undefined });
  });
});

describe("userGetScrobbleCount", () => {
  it("should read the range's total from one recent track", async () => {
    const params = lastfmReturns({
      recenttracks: {
        track: [recentTrack("Test", playedAt("1609459200"))],
        "@attr": { total: "1234" },
      },
    });

    const count = await userGetScrobbleCount("testuser", {
      from: new Date("2021-01-01T00:00:00Z"),
      to: new Date("2021-01-02T00:00:00Z"),
    });

    expect(params()).toMatchObject({
      method: "user.getrecenttracks",
      user: "testuser",
      limit: "1",
      from: "1609459200",
      to: "1609545599",
    });
    expect(count).toBe(1234);
  });
});
