import { http, HttpResponse, type JsonBodyType } from "msw";
import { describe, expect, it, vi } from "vitest";

import { config } from "@/config";
import { server } from "@/mocks/node";

import {
  albumGetInfo,
  albumUrl,
  bulk,
  userGetLovedTracks,
  userGetScrobbles,
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

const scrobbles = (user = "testuser") =>
  userGetScrobbles(user, {
    from: new Date("2021-01-01T00:00:00Z"),
    to: new Date("2021-01-02T00:00:00Z"),
    limit: 10,
  });

describe("Last.fm calls", () => {
  it("should send the API key and parse either artist form", async () => {
    const params = lastfmReturns({
      recenttracks: {
        "@attr": { total: "2" },
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

    const { tracks } = await scrobbles();

    expect(params()).toMatchObject({
      api_key: "test-last-fm-api-key",
      format: "json",
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

  it("should handle invalid response schema", async () => {
    lastfmReturns({ invalid: "data" });

    await expect(scrobbles()).rejects.toThrow();
  });

  it("should handle network errors", async () => {
    lastfmReturns(HttpResponse.error());

    await expect(scrobbles()).rejects.toThrow();
  });

  it("should configure fetch with 10 second timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    lastfmReturns({ recenttracks: { track: [], "@attr": { total: "0" } } });

    await scrobbles();

    expect(timeoutSpy).toHaveBeenCalledWith(10000);
  });

  it("should handle an HTTP error", async () => {
    lastfmReturns(
      new HttpResponse(null, {
        status: 503,
        statusText: "Service Unavailable",
      }),
    );

    await expect(scrobbles()).rejects.toThrow(
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

    await expect(scrobbles("nobody")).rejects.toThrow(
      "Last.fm API error 6: User not found",
    );
  });

  it("should throw a body that isn't JSON", async () => {
    lastfmReturns(new HttpResponse("<html>", { status: 200 }));

    await expect(scrobbles()).rejects.toThrow(SyntaxError);
  });
});

describe("albumGetInfo", () => {
  const images = (hash: string, host: string = config.lastfmCoverCdn) =>
    [
      ["small", "34s"],
      ["extralarge", "300x300"],
    ].map(([size, path]) => ({
      size,
      "#text": hash && `${host}${path}/${hash}.jpg`,
    }));
  const page = (image: object[], url = "https://www.last.fm/music/Test") =>
    lastfmReturns({ album: { url, image } });

  it("should fetch an album's page and cover", async () => {
    const params = lastfmReturns({
      album: {
        url: "https://www.last.fm/music/Stars/Set+Yourself+on+Fire",
        image: [
          {
            size: "extralarge",
            "#text": `${config.lastfmCoverCdn}300x300/abc.png`,
          },
        ],
      },
    });

    await expect(
      albumGetInfo("Stars", "Set Yourself on Fire"),
    ).resolves.toEqual({
      url: "https://www.last.fm/music/Stars/Set+Yourself+on+Fire",
      cover: `${config.lastfmCoverCdn}abc.png`,
    });
    expect(params()).toMatchObject({
      method: "album.getinfo",
      artist: "Stars",
      album: "Set Yourself on Fire",
    });
  });

  it("should reject an album linking off Last.fm", async () => {
    page(images("abc123"), "https://example.com/Test");

    await expect(albumGetInfo("Test Artist", "Test")).rejects.toThrow();
  });

  it.each([
    ["no art", ""],
    ["Last.fm's placeholder star", "2a96cbd8b46e442fc41c2b86b821562f"],
    ["another host", "abc123", "https://example.com/i/u/"],
  ])("should leave out the cover for %s", async (_, hash, host?: string) => {
    page(images(hash, host));

    const { cover } = await albumGetInfo("Test Artist", "Test");

    expect(cover).toBeUndefined();
  });
});

describe("albumUrl", () => {
  it("should link an album's page, writing a space as +", () => {
    expect(albumUrl("Slaughter Beach, Dog", "AC/DC 50/50")).toBe(
      "https://www.last.fm/music/Slaughter+Beach%2C+Dog/AC%2FDC+50%2F50",
    );
  });
});

describe("bulk", () => {
  it("should keep at most four in flight, even for a call arriving as one finishes", async () => {
    let inFlight = 0;
    let most = 0;
    const releases: (() => void)[] = [];
    const request = () => {
      most = Math.max(most, ++inFlight);
      return new Promise<void>((resolve) =>
        releases.push(() => {
          inFlight--;
          resolve();
        }),
      );
    };
    const calls = Array.from({ length: 5 }, () => bulk(request));

    releases.shift()?.();
    // Runs after the finished call frees its slot, before the queued call resumes.
    queueMicrotask(() => calls.push(bulk(request)));
    while (calls.length < 6 || releases.length > 0) {
      await new Promise((resolve) => setTimeout(resolve));
      releases.shift()?.();
    }
    await Promise.all(calls);

    expect(most).toBe(4);
  });
});

describe("userGetLovedTracks", () => {
  it("should read a page of loved tracks and how many pages there are", async () => {
    const params = lastfmReturns({
      lovedtracks: {
        track: [
          {
            name: "Test",
            artist: { name: "Artist" },
            date: { uts: "1609459200" },
          },
        ],
        "@attr": { totalPages: "3" },
      },
    });

    const loved = await userGetLovedTracks("testuser", {
      limit: 1000,
      page: 2,
    });

    expect(params()).toMatchObject({
      method: "user.getlovedtracks",
      user: "testuser",
      limit: "1000",
      page: "2",
    });
    expect(loved).toEqual({
      totalPages: 3,
      tracks: [
        {
          name: "Test",
          artist: "Artist",
          lovedAt: new Date("2021-01-01T00:00:00Z"),
        },
      ],
    });
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
      page: 2,
    });

    expect(params()).toMatchObject({
      method: "user.getrecenttracks",
      user: "testuser",
      limit: "1",
      page: "2",
      from: "1609459200",
      to: "1609545600",
    });
    expect(scrobbles).toEqual({
      total: 1234,
      tracks: [expect.objectContaining({ name: "Test" })],
      nowPlaying: expect.objectContaining({ name: "Now", nowPlaying: true }),
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
