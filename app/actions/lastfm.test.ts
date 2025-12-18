import { afterEach, describe, expect, it, vi } from "vitest";

import {
  userGetRecentTracks,
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
  getTopAlbums,
  getTopArtists,
  getTopTracks,
} from "./lastfm";

vi.mock(import("@/lib/lastfm"), () => ({
  userGetRecentTracks: vi.fn(),
  userGetTopTracks: vi.fn(),
  userGetTopArtists: vi.fn(),
  userGetTopAlbums: vi.fn(),
}));

vi.mock(import("next/cache"), () => ({ cacheLife: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getRecentTracks", () => {
  it("should return success status with tracks when userGetRecentTracks succeeds", async () => {
    const mockTracks: UserGetRecentTracksResponse = [
      {
        name: "Test Track",
        artist: "Test Artist",
        album: "Test Album",
        playedAt: new Date("2021-01-01T00:00:00Z").getTime(),
        nowPlaying: false,
        loved: true,
      },
      {
        name: "Another Track",
        artist: "Another Artist",
        album: "Another Album",
        playedAt: new Date("2021-01-02T00:00:00Z").getTime(),
        nowPlaying: false,
        loved: false,
      },
    ];

    vi.mocked(userGetRecentTracks).mockResolvedValue(mockTracks);

    const result = await getRecentTracks();

    expect(userGetRecentTracks).toHaveBeenCalledWith("magijo", { limit: 5 });
    expect(result).toEqual({ status: "ok", tracks: mockTracks });
  });

  it("should return error status when userGetRecentTracks fails", async () => {
    const logErrorSpy = vi.spyOn(log, "error").mockImplementation(() => {});

    const mockError = new Error("API error");
    vi.mocked(userGetRecentTracks).mockRejectedValue(mockError);

    const result = await getRecentTracks();

    expect(result).toEqual({
      status: "error",
      error: "Failed to fetch recent tracks",
    });

    expect(logErrorSpy).toHaveBeenCalledWith(
      { err: mockError, action: "getRecentTracks" },
      "Error fetching recent tracks",
    );
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
    expect(result).toEqual({ status: "ok", tracks: mockTracks });
  });

  it("should return error status when fetch fails", async () => {
    const logErrorSpy = vi.spyOn(log, "error").mockImplementation(() => {});

    const mockError = new Error("API error");
    vi.mocked(userGetTopTracks).mockRejectedValue(mockError);

    const result = await getTopTracks("7day");

    expect(result).toEqual({
      status: "error",
      error: "Failed to fetch top tracks",
    });

    expect(logErrorSpy).toHaveBeenCalledWith(
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
    expect(result).toEqual({ status: "ok", artists: mockArtists });
  });

  it("should return error status when fetch fails", async () => {
    const logErrorSpy = vi.spyOn(log, "error").mockImplementation(() => {});

    const mockError = new Error("API error");
    vi.mocked(userGetTopArtists).mockRejectedValue(mockError);

    const result = await getTopArtists("1month");

    expect(result).toEqual({
      status: "error",
      error: "Failed to fetch top artists",
    });

    expect(logErrorSpy).toHaveBeenCalledWith(
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
    expect(result).toEqual({ status: "ok", albums: mockAlbums });
  });

  it("should return error status when fetch fails", async () => {
    const logErrorSpy = vi.spyOn(log, "error").mockImplementation(() => {});

    const mockError = new Error("API error");
    vi.mocked(userGetTopAlbums).mockRejectedValue(mockError);

    const result = await getTopAlbums("3month");

    expect(result).toEqual({
      status: "error",
      error: "Failed to fetch top albums",
    });

    expect(logErrorSpy).toHaveBeenCalledWith(
      { err: mockError, action: "getTopAlbums" },
      "Error fetching top albums",
    );
  });
});
