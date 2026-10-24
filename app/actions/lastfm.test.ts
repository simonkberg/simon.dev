import { cacheLife, refresh } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  userGetRecentTracks,
  userGetScrobbles,
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

import {
  getRecentTracks,
  getOnThisDay,
  getScrobbles,
  getTopArtistByBucket,
  getTopAlbums,
  getTopArtists,
  getTopTracks,
  type RecentTrack,
  refreshRecentTracks,
} from "./lastfm";

vi.mock(import("@/lib/lastfm"), () => ({
  userGetRecentTracks: vi.fn(),
  userGetScrobbles: vi.fn(),
  userGetTopArtistInRange: vi.fn(),
  userGetTopTracks: vi.fn(),
  userGetTopArtists: vi.fn(),
  userGetTopAlbums: vi.fn(),
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
    const mockAlbums: UserGetTopAlbumsResponse = [
      { name: "Album 1", artist: "Artist 1", playcount: 200, rank: 1 },
      { name: "Album 2", artist: "Artist 2", playcount: 150, rank: 2 },
    ];

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
    vi.mocked(userGetScrobbles).mockResolvedValue({ total: 42, tracks: [] });
  });

  it("should count each bucket", async () => {
    const result = await getScrobbles("7day");

    expect(userGetScrobbles).toHaveBeenCalledTimes(7);
    expect(userGetScrobbles).toHaveBeenLastCalledWith("magijo", {
      from: new Date("2026-10-22T22:00:00Z"),
      to: new Date("2026-10-23T22:00:00Z"),
      limit: 1,
    });
    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("hours");
    expect(result).toEqual({
      status: "ok",
      scrobbles: expect.arrayContaining([
        { label: "Oct 23", count: 42, current: true },
      ]),
    });
  });

  it("should count all time per year since the first scrobbles", async () => {
    const result = await getScrobbles("overall");

    expect(userGetScrobbles).toHaveBeenCalledTimes(2026 - 2007 + 1);
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
    vi.mocked(userGetScrobbles).mockRejectedValue(mockError);

    const result = await getScrobbles("7day");

    expect(result).toEqual({
      status: "error",
      error: "Failed to fetch scrobbles",
    });
    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("seconds");
    expect(log.error).toHaveBeenCalledWith(
      { err: mockError, action: "getScrobbles" },
      "Error fetching scrobbles",
    );
  });
});

describe("getTopArtistByBucket", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T09:15:00Z"));
  });

  it("should find each bucket's top artist", async () => {
    const artist = { name: "Smog", playcount: 23 };
    vi.mocked(userGetTopArtistInRange).mockResolvedValue(artist);

    const result = await getTopArtistByBucket("overall");

    expect(userGetTopArtistInRange).toHaveBeenCalledTimes(2026 - 2007 + 1);
    expect(userGetTopArtistInRange).toHaveBeenLastCalledWith("magijo", {
      from: new Date("2025-12-31T23:00:00Z"),
      to: new Date("2026-12-31T23:00:00Z"),
    });
    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("hours");
    expect(result).toMatchObject({
      status: "ok",
      buckets: expect.arrayContaining([
        { label: "2007", artist },
        { label: "2026", artist },
      ]),
    });
  });

  it("should return error status when an artist fails", async () => {
    const mockError = new Error("API error");
    vi.mocked(userGetTopArtistInRange).mockRejectedValue(mockError);

    const result = await getTopArtistByBucket("overall");

    expect(result).toEqual({
      status: "error",
      error: "Failed to fetch top artist by bucket",
    });
    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("seconds");
    expect(log.error).toHaveBeenCalledWith(
      { err: mockError, action: "getTopArtistByBucket" },
      "Error fetching top artist by bucket",
    );
  });
});

describe("getOnThisDay", () => {
  const played = (name: string, artist: string): RecentTrack => ({
    name,
    artist,
    album: "",
    playedAt: new Date("2025-10-23T12:00:00Z"),
    nowPlaying: false,
    loved: false,
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T09:15:00Z"));
    vi.mocked(userGetScrobbles).mockResolvedValue({ total: 0, tracks: [] });
  });

  it("should read today's date in each past year", async () => {
    // Newest first, so the earliest play is last.
    vi.mocked(userGetScrobbles).mockResolvedValueOnce({
      total: 5,
      tracks: [
        played("Late", "Other"),
        played("Second", "Top"),
        played("Second", "Top"),
        played("First", "Top"),
        played("First", "Top"),
      ],
    });

    const result = await getOnThisDay();

    expect(userGetScrobbles).toHaveBeenCalledTimes(2026 - 2007);
    expect(userGetScrobbles).toHaveBeenNthCalledWith(1, "magijo", {
      from: new Date("2025-10-22T22:00:00Z"),
      to: new Date("2025-10-23T22:00:00Z"),
      limit: 200,
    });
    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("hours");
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
    const mockError = new Error("API error");
    vi.mocked(userGetScrobbles).mockRejectedValue(mockError);

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
