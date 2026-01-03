import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { server } from "@/mocks/node";

import {
  userGetRecentTracks,
  userGetTopAlbums,
  userGetTopArtists,
  userGetTopTracks,
} from "./lastfm";

vi.mock(import("server-only"), () => ({}));

const LASTFM_BASE_URL = "https://ws.audioscrobbler.com/2.0/";

describe("userGetRecentTracks", () => {
  it("should fetch and parse recent tracks successfully", async () => {
    server.use(
      http.get(LASTFM_BASE_URL, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("method")).toBe("user.getrecenttracks");
        expect(url.searchParams.get("api_key")).toBe("test-last-fm-api-key");
        expect(url.searchParams.get("user")).toBe("testuser");
        expect(url.searchParams.get("extended")).toBe("1");

        return HttpResponse.json({
          recenttracks: {
            track: [
              {
                name: "Test Track",
                artist: { name: "Test Artist" },
                album: { "#text": "Test Album" },
                date: { uts: "1609459200" },
                loved: "1",
              },
              {
                name: "Another Track",
                artist: { "#text": "Another Artist" },
                album: { "#text": "Another Album" },
                date: { uts: "1609372800" },
                loved: "0",
              },
            ],
          },
        });
      }),
    );

    const tracks = await userGetRecentTracks("testuser");

    expect(tracks).toEqual([
      {
        name: "Test Track",
        artist: "Test Artist",
        album: "Test Album",
        playedAt: new Date(1609459200000),
        nowPlaying: false,
        loved: true,
      },
      {
        name: "Another Track",
        artist: "Another Artist",
        album: "Another Album",
        playedAt: new Date(1609372800000),
        nowPlaying: false,
        loved: false,
      },
    ]);
  });

  it("should handle now playing track", async () => {
    server.use(
      http.get(LASTFM_BASE_URL, () =>
        HttpResponse.json({
          recenttracks: {
            track: [
              {
                name: "Now Playing Track",
                artist: { name: "Test Artist" },
                album: { "#text": "Test Album" },
                "@attr": { nowplaying: "true" },
              },
            ],
          },
        }),
      ),
    );

    const tracks = await userGetRecentTracks("testuser");

    expect(tracks[0]?.nowPlaying).toBe(true);
    expect(tracks[0]?.playedAt).toBeUndefined();
  });

  it("should support limit and page parameters", async () => {
    server.use(
      http.get(LASTFM_BASE_URL, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("limit")).toBe("5");
        expect(url.searchParams.get("page")).toBe("2");

        return HttpResponse.json({ recenttracks: { track: [] } });
      }),
    );

    await userGetRecentTracks("testuser", { limit: 5, page: 2 });
  });

  it("should handle invalid response schema", async () => {
    server.use(
      http.get(LASTFM_BASE_URL, () => HttpResponse.json({ invalid: "data" })),
    );

    await expect(userGetRecentTracks("testuser")).rejects.toThrow();
  });

  it("should handle network errors", async () => {
    server.use(http.get(LASTFM_BASE_URL, () => HttpResponse.error()));

    await expect(userGetRecentTracks("testuser")).rejects.toThrow();
  });

  it("should configure fetch with 10 second timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    server.use(
      http.get(LASTFM_BASE_URL, () =>
        HttpResponse.json({ recenttracks: { track: [] } }),
      ),
    );

    await userGetRecentTracks("testuser");

    expect(timeoutSpy).toHaveBeenCalledWith(10000);
    timeoutSpy.mockRestore();
  });

  it.each([
    { status: 404, statusText: "Not Found" },
    { status: 429, statusText: "Too Many Requests" },
    { status: 500, statusText: "Internal Server Error" },
    { status: 503, statusText: "Service Unavailable" },
  ])("should handle HTTP $status error", async ({ status, statusText }) => {
    server.use(
      http.get(
        LASTFM_BASE_URL,
        () => new HttpResponse(null, { status, statusText }),
      ),
    );

    await expect(userGetRecentTracks("testuser")).rejects.toThrow(
      `Last.fm API error: ${status} ${statusText}`,
    );
  });

  it("should enforce limit when now playing track is returned", async () => {
    server.use(
      http.get(LASTFM_BASE_URL, () =>
        HttpResponse.json({
          recenttracks: {
            track: [
              {
                name: "Now Playing",
                artist: { name: "Artist Now" },
                album: { "#text": "Album Now" },
                "@attr": { nowplaying: "true" },
              },
              {
                name: "Track 1",
                artist: { name: "Artist 1" },
                album: { "#text": "Album 1" },
                date: { uts: "1609459200" },
              },
              {
                name: "Track 2",
                artist: { name: "Artist 2" },
                album: { "#text": "Album 2" },
                date: { uts: "1609372800" },
              },
              {
                name: "Track 3",
                artist: { name: "Artist 3" },
                album: { "#text": "Album 3" },
                date: { uts: "1609286400" },
              },
            ],
          },
        }),
      ),
    );

    const tracks = await userGetRecentTracks("testuser", { limit: 3 });

    expect(tracks).toHaveLength(3);
    expect(tracks[0]?.name).toBe("Now Playing");
    expect(tracks[1]?.name).toBe("Track 1");
    expect(tracks[2]?.name).toBe("Track 2");
    // Track 3 should be discarded to enforce limit
  });
});

describe("userGetTopTracks", () => {
  it("should fetch and parse top tracks successfully", async () => {
    server.use(
      http.get(LASTFM_BASE_URL, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("method")).toBe("user.gettoptracks");
        expect(url.searchParams.get("api_key")).toBe("test-last-fm-api-key");
        expect(url.searchParams.get("user")).toBe("testuser");
        expect(url.searchParams.get("period")).toBe("7day");
        expect(url.searchParams.get("limit")).toBe("10");

        return HttpResponse.json({
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
      }),
    );

    const tracks = await userGetTopTracks("testuser", {
      period: "7day",
      limit: 10,
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
    server.use(
      http.get(LASTFM_BASE_URL, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("method")).toBe("user.gettopartists");
        expect(url.searchParams.get("user")).toBe("testuser");
        expect(url.searchParams.get("period")).toBe("1month");
        expect(url.searchParams.get("limit")).toBe("10");

        return HttpResponse.json({
          topartists: {
            artist: [
              { name: "Test Artist", playcount: "500", "@attr": { rank: "1" } },
              {
                name: "Another Artist",
                playcount: "300",
                "@attr": { rank: "2" },
              },
            ],
          },
        });
      }),
    );

    const artists = await userGetTopArtists("testuser", {
      period: "1month",
      limit: 10,
    });

    expect(artists).toEqual([
      { name: "Test Artist", playcount: 500, rank: 1 },
      { name: "Another Artist", playcount: 300, rank: 2 },
    ]);
  });
});

describe("userGetTopAlbums", () => {
  it("should fetch and parse top albums successfully", async () => {
    server.use(
      http.get(LASTFM_BASE_URL, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("method")).toBe("user.gettopalbums");
        expect(url.searchParams.get("user")).toBe("testuser");
        expect(url.searchParams.get("period")).toBe("3month");
        expect(url.searchParams.get("limit")).toBe("10");

        return HttpResponse.json({
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
      }),
    );

    const albums = await userGetTopAlbums("testuser", {
      period: "3month",
      limit: 10,
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
