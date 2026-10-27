import { cacheLife, refresh } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  userGetRecentTracks,
  type UserGetRecentTracksResponse,
  userGetTopAlbums,
  userGetTopArtists,
  type UserGetTopArtistsResponse,
  userGetTopTracks,
  type UserGetTopTracksResponse,
} from "@/lib/lastfm";
import { log } from "@/lib/log";
import { countScrobbles, playsIn, topArtist } from "@/lib/scrobbles";
import { topAlbum } from "@/mocks/lastfm";

import {
  getRecentTracks,
  getOnThisDay,
  getScrobbles,
  getTopArtistByBucket,
  getTopAlbums,
  getTopArtists,
  getTopTracks,
  refreshRecentTracks,
} from "./lastfm";

vi.mock(import("@/lib/lastfm"), () => ({
  userGetRecentTracks: vi.fn(),
  userGetTopTracks: vi.fn(),
  userGetTopArtists: vi.fn(),
  userGetTopAlbums: vi.fn(),
  TOP_ALBUMS: 10 as const,
}));

vi.mock(import("@/lib/scrobbles"), () => ({
  countScrobbles: vi.fn(),
  playsIn: vi.fn(),
  topArtist: vi.fn(),
}));

vi.mock(import("next/cache"), () => ({ cacheLife: vi.fn(), refresh: vi.fn() }));

describe("getRecentTracks", () => {
  it("should return success status with tracks when userGetRecentTracks succeeds", async () => {
    const mockTracks: UserGetRecentTracksResponse = [
      {
        name: "Test Track",
        artist: "Test Artist",
        album: "Test Album",
        playedAt: new Date("2021-01-01T00:00:00Z"),
        nowPlaying: false,
        loved: true,
      },
      {
        name: "Another Track",
        artist: "Another Artist",
        album: "Another Album",
        playedAt: new Date("2021-01-02T00:00:00Z"),
        nowPlaying: false,
        loved: false,
      },
    ];

    vi.mocked(userGetRecentTracks).mockResolvedValue(mockTracks);

    const result = await getRecentTracks();

    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("minutes");
    expect(userGetRecentTracks).toHaveBeenCalledWith("magijo", { limit: 5 });
    expect(result).toEqual({ status: "ok", tracks: mockTracks });
  });

  it("should return error status when userGetRecentTracks fails", async () => {
    const mockError = new Error("API error");
    vi.mocked(userGetRecentTracks).mockRejectedValue(mockError);

    const result = await getRecentTracks();

    expect(result).toEqual({
      status: "error",
      error: "Failed to fetch recent tracks",
    });

    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("seconds");
    expect(log.error).toHaveBeenCalledWith(
      { err: mockError, action: "getRecentTracks" },
      "Error fetching recent tracks",
    );
  });
});

describe("refreshRecentTracks", () => {
  it("should re-render the page so the list updates", async () => {
    await refreshRecentTracks();

    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe("getTopTracks", () => {
  it("should return success status with tracks", async () => {
    const mockTracks: UserGetTopTracksResponse = [
      { name: "Track 1", artist: "Artist 1", playcount: 100, rank: 1 },
      { name: "Track 2", artist: "Artist 2", playcount: 50, rank: 2 },
    ];

    vi.mocked(userGetTopTracks).mockResolvedValue(mockTracks);

    const result = await getTopTracks("7day");

    expect(userGetTopTracks).toHaveBeenCalledWith("magijo", {
      period: "7day",
      limit: 10,
    });
    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("hours");
    expect(result).toEqual({ status: "ok", tracks: mockTracks });
  });

  it("should return error status when fetch fails", async () => {
    const mockError = new Error("API error");
    vi.mocked(userGetTopTracks).mockRejectedValue(mockError);

    const result = await getTopTracks("7day");

    expect(result).toEqual({
      status: "error",
      error: "Failed to fetch top tracks",
    });

    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("seconds");
    expect(log.error).toHaveBeenCalledWith(
      { err: mockError, action: "getTopTracks" },
      "Error fetching top tracks",
    );
  });
});

describe("getTopArtists", () => {
  it("should return success status with artists", async () => {
    const mockArtists: UserGetTopArtistsResponse = [
      { name: "Artist 1", playcount: 500, rank: 1 },
      { name: "Artist 2", playcount: 300, rank: 2 },
    ];

    vi.mocked(userGetTopArtists).mockResolvedValue(mockArtists);

    const result = await getTopArtists("1month");

    expect(userGetTopArtists).toHaveBeenCalledWith("magijo", {
      period: "1month",
      limit: 10,
    });
    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("hours");
    expect(result).toEqual({ status: "ok", artists: mockArtists });
  });

  it("should return error status when fetch fails", async () => {
    const mockError = new Error("API error");
    vi.mocked(userGetTopArtists).mockRejectedValue(mockError);

    const result = await getTopArtists("1month");

    expect(result).toEqual({
      status: "error",
      error: "Failed to fetch top artists",
    });

    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("seconds");
    expect(log.error).toHaveBeenCalledWith(
      { err: mockError, action: "getTopArtists" },
      "Error fetching top artists",
    );
  });
});

describe("getTopAlbums", () => {
  it("should return success status with albums", async () => {
    const mockAlbums = [topAlbum("Album 1", "Artist 1", 1)];

    vi.mocked(userGetTopAlbums).mockResolvedValue(mockAlbums);

    const result = await getTopAlbums("3month");

    expect(userGetTopAlbums).toHaveBeenCalledWith("magijo", {
      period: "3month",
      limit: 10,
    });
    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("hours");
    expect(result).toEqual({ status: "ok", albums: mockAlbums });
  });

  it("should return error status when fetch fails", async () => {
    const mockError = new Error("API error");
    vi.mocked(userGetTopAlbums).mockRejectedValue(mockError);

    const result = await getTopAlbums("3month");

    expect(result).toEqual({
      status: "error",
      error: "Failed to fetch top albums",
    });

    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("seconds");
    expect(log.error).toHaveBeenCalledWith(
      { err: mockError, action: "getTopAlbums" },
      "Error fetching top albums",
    );
  });
});

describe("getScrobbles", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T09:15:00Z"));
    vi.mocked(countScrobbles).mockResolvedValue(42);
  });

  it("should count each bucket", async () => {
    const result = await getScrobbles("7day");

    expect(countScrobbles).toHaveBeenCalledTimes(7);
    expect(countScrobbles).toHaveBeenLastCalledWith(
      new Date("2026-10-22T22:00:00Z"),
      new Date("2026-10-23T22:00:00Z"),
    );
    expect(vi.mocked(cacheLife).mock.calls).toEqual([
      ...Array.from({ length: 6 }, () => ["days"]),
      [{ stale: 300, revalidate: 3600, expire: 3600 + 86_400 }],
    ]);
    expect(result).toEqual({
      status: "ok",
      scrobbles: expect.arrayContaining([
        { label: "Oct 23", count: 42, current: true },
      ]),
    });
  });

  it("should regenerate when the current bucket ends", async () => {
    vi.setSystemTime(new Date("2026-10-23T21:30:00Z"));

    await getScrobbles("7day");

    expect(cacheLife).toHaveBeenLastCalledWith({
      stale: 300,
      revalidate: 1800,
      expire: 1800 + 86_400,
    });
  });

  it("should refetch a bucket that ended within the hour", async () => {
    vi.setSystemTime(new Date("2026-10-23T22:30:00Z"));

    await getScrobbles("7day");

    expect(cacheLife).toHaveBeenCalledTimes(5 + 1);
  });

  it("should count all time per year since the first scrobbles", async () => {
    const result = await getScrobbles("overall");

    expect(countScrobbles).toHaveBeenCalledTimes(2026 - 2007 + 1);
    expect(result).toMatchObject({
      status: "ok",
      scrobbles: expect.arrayContaining([
        { label: "2007", count: 42, current: false },
        { label: "2026", count: 42, current: true },
      ]),
    });
  });

  it("should return error status when a count fails", async () => {
    const mockError = new Error("API error");
    vi.mocked(countScrobbles).mockRejectedValue(mockError);

    const result = await getScrobbles("7day");

    expect(result).toEqual({
      status: "error",
      error: "Failed to fetch scrobbles",
    });
    expect(cacheLife).toHaveBeenLastCalledWith("seconds");
    expect(log.error).toHaveBeenCalledWith(
      { err: mockError, action: "getScrobbles" },
      "Error fetching scrobbles",
    );
  });

  it.each([new Error("API error"), "API error"])(
    "should log an ended bucket's failure with its message, from %o",
    async (reason) => {
      vi.mocked(countScrobbles).mockRejectedValueOnce(reason);

      await getScrobbles("7day");

      expect(log.error).toHaveBeenCalledWith(
        {
          err: expect.objectContaining({ message: "API error" }),
          action: "getScrobbles",
        },
        "Error fetching scrobbles",
      );
    },
  );
});

describe("getTopArtistByBucket", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T09:15:00Z"));
  });

  it("should find each bucket's top artist", async () => {
    const artist = { name: "Smog", playcount: 23 };
    vi.mocked(topArtist).mockResolvedValue(artist);

    const result = await getTopArtistByBucket("7day");

    expect(topArtist).toHaveBeenCalledTimes(7);
    expect(topArtist).toHaveBeenLastCalledWith(
      new Date("2026-10-22T22:00:00Z"),
      new Date("2026-10-23T22:00:00Z"),
    );
    expect(cacheLife).toHaveBeenLastCalledWith({
      stale: 300,
      revalidate: 3600,
      expire: 3600 + 86_400,
    });
    expect(result).toMatchObject({
      status: "ok",
      buckets: expect.arrayContaining([
        { label: "Oct 17", artist },
        { label: "Oct 23", artist },
      ]),
    });
  });

  it("should return error status when an artist fails", async () => {
    const mockError = new Error("API error");
    vi.mocked(topArtist).mockRejectedValue(mockError);

    const result = await getTopArtistByBucket("7day");

    expect(result).toEqual({
      status: "error",
      error: "Failed to fetch top artist by bucket",
    });
    expect(cacheLife).toHaveBeenLastCalledWith("seconds");
    expect(log.error).toHaveBeenCalledWith(
      { err: mockError, action: "getTopArtistByBucket", period: "7day" },
      "Error fetching top artist by bucket",
    );
  });
});

describe("getOnThisDay", () => {
  const played = (artist: string, track: string) => ({ artist, track });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T09:15:00Z"));
    vi.mocked(playsIn).mockResolvedValue([]);
  });

  it("should read today's date in each past year", async () => {
    vi.mocked(playsIn).mockResolvedValueOnce([
      played("Top", "First"),
      played("Top", "First"),
      played("Top", "Second"),
      played("Top", "Second"),
      played("Other", "Late"),
    ]);

    const result = await getOnThisDay();

    expect(playsIn).toHaveBeenCalledTimes(2026 - 2007);
    expect(playsIn).toHaveBeenNthCalledWith(
      1,
      new Date("2025-10-22T22:00:00Z"),
      new Date("2025-10-23T22:00:00Z"),
    );
    // Until Stockholm's midnight.
    expect(cacheLife).toHaveBeenCalledExactlyOnceWith({
      stale: 300,
      revalidate: 45_900,
      expire: 45_900 + 86_400,
    });
    expect(result).toMatchObject({
      status: "ok",
      days: {
        date: "Oct 23",
        years: expect.arrayContaining([
          { year: "2025", count: 5, top: { artist: "Top", track: "First" } },
          { year: "2007", count: 0, top: undefined },
        ]),
      },
    });
  });

  it("should return error status when a day fails", async () => {
    const mockError = new Error("Database error");
    vi.mocked(playsIn).mockRejectedValue(mockError);

    const result = await getOnThisDay();

    expect(result).toEqual({
      status: "error",
      error: "Failed to fetch on this day",
    });
    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("seconds");
    expect(log.error).toHaveBeenCalledWith(
      { err: mockError, action: "getOnThisDay" },
      "Error fetching on this day",
    );
  });
});
