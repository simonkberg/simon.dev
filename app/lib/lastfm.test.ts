import { http, HttpResponse, type JsonBodyType } from "msw";
import { describe, expect, it, vi } from "vitest";

import { server } from "@/mocks/node";

import {
  userGetRecentTracks,
  userGetScrobbles,
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
  it("should fetch and parse top albums successfully", async () => {
    const params = lastfmReturns({
      topalbums: {
        album: [
          {
            name: "Test Album",
            playcount: "200",
            artist: { name: "Test Artist" },
            "@attr": { rank: "1" },
          },
          {
            name: "Another Album",
            playcount: "150",
            artist: { name: "Another Artist" },
            "@attr": { rank: "2" },
          },
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
      { name: "Test Album", artist: "Test Artist", playcount: 200, rank: 1 },
      {
        name: "Another Album",
        artist: "Another Artist",
        playcount: 150,
        rank: 2,
      },
    ]);
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
