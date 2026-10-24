import { cacheLife, refresh } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  userGetRecentTracks,
  userGetScrobbleCount,
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
  getScrobbles,
  getTopAlbums,
  getTopArtists,
  getTopTracks,
  refreshRecentTracks,
} from "./lastfm";

vi.mock(import("@/lib/lastfm"), () => ({
  userGetRecentTracks: vi.fn(),
  userGetScrobbleCount: vi.fn(),
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
  const topArtist = { name: "Smog", playcount: 23 };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T09:15:00Z"));
    vi.mocked(userGetScrobbleCount).mockResolvedValue(42);
    vi.mocked(userGetTopArtistInRange).mockResolvedValue(topArtist);
  });

  it("should count each bucket and find its top artist", async () => {
    const result = await getScrobbles("7day");

    expect(userGetScrobbleCount).toHaveBeenCalledTimes(7);
    const range = {
      from: new Date("2026-10-22T22:00:00Z"),
      to: new Date("2026-10-23T22:00:00Z"),
    };
    expect(userGetScrobbleCount).toHaveBeenLastCalledWith("magijo", range);
    expect(userGetTopArtistInRange).toHaveBeenLastCalledWith("magijo", range);
    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("hours");
    expect(result).toEqual({
      status: "ok",
      scrobbles: expect.arrayContaining([
        { label: "Oct 23", count: 42, topArtist, current: true },
      ]),
    });
  });

  it("should count all time per year since the first scrobbles", async () => {
    const result = await getScrobbles("overall");

    expect(userGetScrobbleCount).toHaveBeenCalledTimes(2026 - 2007 + 1);
    expect(result).toMatchObject({
      status: "ok",
      scrobbles: expect.arrayContaining([
        { label: "2007", count: 42, topArtist, current: false },
        { label: "2026", count: 42, topArtist, current: true },
      ]),
    });
  });

  it("should keep the counts when a top artist fails", async () => {
    const mockError = new Error("API error");
    vi.mocked(userGetTopArtistInRange).mockRejectedValueOnce(mockError);

    const result = await getScrobbles("7day");

    expect(result).toMatchObject({
      status: "ok",
      scrobbles: expect.arrayContaining([
        { label: "Oct 17", count: 42, topArtist: undefined, current: false },
      ]),
    });
    expect(log.warn).toHaveBeenCalledExactlyOnceWith(
      { err: mockError, label: "Oct 17" },
      "Error fetching top artist",
    );
  });

  it("should return error status when a count fails", async () => {
    const mockError = new Error("API error");
    vi.mocked(userGetScrobbleCount).mockRejectedValue(mockError);

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
