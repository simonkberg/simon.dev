import { cacheLife, refresh } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { albumGetInfo } from "@/lib/lastfm";
import { log } from "@/lib/log";
import {
  countScrobbles,
  playsIn,
  recentPlays,
  topArtist,
  topArtists,
  topPlayed,
} from "@/lib/scrobbles";

import {
  getDayPlays,
  getDailyScrobbles,
  getRecentTracks,
  getOnThisDay,
  getScrobbleMonths,
  getScrobbles,
  getTopArtistByBucket,
  getTopAlbums,
  getTopArtists,
  getTopTracks,
  refreshRecentTracks,
} from "./listening";

vi.mock(import("@/lib/lastfm"), async (importOriginal) => ({
  ...(await importOriginal()),
  bulk: (request) => request(),
  albumGetInfo: vi.fn(),
}));

vi.mock(import("@/lib/scrobbles"), () => ({
  countScrobbles: vi.fn(),
  LATE_MS: 14 * 24 * 60 * 60_000,
  playsIn: vi.fn(),
  recentPlays: vi.fn(),
  topArtist: vi.fn(),
  topArtists: vi.fn(),
  topPlayed: vi.fn(),
}));

vi.mock(import("next/cache"), () => ({ cacheLife: vi.fn(), refresh: vi.fn() }));

describe("getRecentTracks", () => {
  it("should return the latest five plays", async () => {
    const tracks = [
      {
        name: "Test Track",
        artist: "Test Artist",
        album: "Test Album",
        playedAt: undefined,
        nowPlaying: true,
        loved: true,
      },
    ];
    vi.mocked(recentPlays).mockResolvedValue(tracks);

    const result = await getRecentTracks();

    expect(cacheLife).toHaveBeenCalledExactlyOnceWith({
      stale: 15,
      revalidate: 15,
      expire: 15,
    });
    expect(recentPlays).toHaveBeenCalledWith(5);
    expect(result).toEqual({ status: "ok", tracks });
  });

  it("should return error status when the query fails", async () => {
    const mockError = new Error("Database error");
    vi.mocked(recentPlays).mockRejectedValue(mockError);

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

describe("top lists", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T09:15:00Z"));
  });

  const played = (name: string, artist: string, playcount: number) => ({
    name,
    artist,
    playcount,
  });

  describe("getTopTracks", () => {
    it("should rank the period's tracks, rereading short periods hourly", async () => {
      vi.mocked(topPlayed).mockResolvedValue([
        played("Track 1", "Artist 1", 100),
        played("Track 2", "Artist 2", 50),
      ]);

      const result = await getTopTracks("7day");

      // The chart's seven Stockholm days.
      expect(topPlayed).toHaveBeenCalledExactlyOnceWith(
        "track",
        new Date("2026-10-16T22:00:00Z"),
        new Date("2026-10-23T09:15:00Z"),
        10,
      );
      expect(cacheLife).toHaveBeenCalledExactlyOnceWith("hours");
      expect(result).toEqual({
        status: "ok",
        tracks: [
          { name: "Track 1", artist: "Artist 1", playcount: 100, rank: 1 },
          { name: "Track 2", artist: "Artist 2", playcount: 50, rank: 2 },
        ],
      });
    });

    it.each([
      ["2012-10", "max", "2012-09-30T22:00:00Z", "2012-10-31T23:00:00Z"],
      ["2026-10", "hours", "2026-09-30T22:00:00Z", "2026-10-31T23:00:00Z"],
    ] as const)(
      "should count all of %s's Stockholm month, cached for %s",
      async (month, life, from, to) => {
        vi.mocked(topPlayed).mockResolvedValue([]);

        await getTopTracks(month);

        expect(topPlayed).toHaveBeenCalledExactlyOnceWith(
          "track",
          new Date(from),
          new Date(to),
          10,
        );
        expect(cacheLife).toHaveBeenCalledExactlyOnceWith(life);
      },
    );

    it("should refuse a month outside the history without querying", async () => {
      const result = await getTopTracks("2026-11");

      expect(result).toMatchObject({ status: "error" });
      expect(topPlayed).not.toHaveBeenCalled();
    });

    it("should return error status when the query fails", async () => {
      const mockError = new Error("Database error");
      vi.mocked(topPlayed).mockRejectedValue(mockError);

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
    it("should rank every artist ever, reread once a day", async () => {
      vi.mocked(topArtists).mockResolvedValue([{ name: "A", playcount: 500 }]);

      const result = await getTopArtists("overall");

      expect(topArtists).toHaveBeenCalledExactlyOnceWith(
        new Date(0),
        new Date("2026-10-23T09:15:00Z"),
        10,
      );
      // Until Stockholm's midnight.
      expect(cacheLife).toHaveBeenCalledExactlyOnceWith({
        stale: 300,
        revalidate: 45_900,
        expire: 45_900 + 86_400,
      });
      expect(result).toEqual({
        status: "ok",
        artists: [{ name: "A", playcount: 500, rank: 1 }],
      });
    });

    it("should return error status when the query fails", async () => {
      const mockError = new Error("Database error");
      vi.mocked(topArtists).mockRejectedValue(mockError);

      const result = await getTopArtists("overall");

      expect(result).toEqual({
        status: "error",
        error: "Failed to fetch top artists",
      });
      expect(log.error).toHaveBeenCalledWith(
        { err: mockError, action: "getTopArtists" },
        "Error fetching top artists",
      );
    });
  });

  describe("getTopAlbums", () => {
    it("should rank the period's albums with Last.fm's page and cover", async () => {
      vi.mocked(topPlayed).mockResolvedValue([
        played("Bloom", "Beach House", 40),
      ]);
      vi.mocked(albumGetInfo).mockResolvedValue({
        url: "https://www.last.fm/music/Beach+House/Bloom",
        cover: "https://lastfm.freetls.fastly.net/i/u/bloom.png",
      });

      const result = await getTopAlbums("3month");

      expect(topPlayed).toHaveBeenCalledWith(
        "album",
        expect.any(Date),
        new Date("2026-10-23T09:15:00Z"),
        10,
      );
      expect(albumGetInfo).toHaveBeenCalledExactlyOnceWith(
        "Beach House",
        "Bloom",
      );
      expect(result).toEqual({
        status: "ok",
        albums: [
          {
            name: "Bloom",
            artist: "Beach House",
            playcount: 40,
            rank: 1,
            url: "https://www.last.fm/music/Beach+House/Bloom",
            cover: "https://lastfm.freetls.fastly.net/i/u/bloom.png",
          },
        ],
      });
    });

    it("should link an album Last.fm can't describe, and retry it soon", async () => {
      const mockError = new Error("Album not found");
      vi.mocked(topPlayed).mockResolvedValue([
        played("Bloom", "Beach House", 40),
      ]);
      vi.mocked(albumGetInfo).mockRejectedValue(mockError);

      const result = await getTopAlbums("3month");

      expect(result).toMatchObject({
        status: "ok",
        albums: [
          {
            name: "Bloom",
            url: "https://www.last.fm/music/Beach+House/Bloom",
            cover: undefined,
          },
        ],
      });
      expect(log.warn).toHaveBeenCalledWith(
        { err: mockError, artist: "Beach House", album: "Bloom" },
        "Error fetching album info",
      );
      expect(cacheLife).toHaveBeenCalledWith("minutes");
    });

    it("should return error status when the query fails", async () => {
      const mockError = new Error("Database error");
      vi.mocked(topPlayed).mockRejectedValue(mockError);

      const result = await getTopAlbums("3month");

      expect(result).toEqual({
        status: "error",
        error: "Failed to fetch top albums",
      });
      expect(log.error).toHaveBeenCalledWith(
        { err: mockError, action: "getTopAlbums" },
        "Error fetching top albums",
      );
    });
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

  it("should keep a bucket for good once no late scrobble can reach it", async () => {
    await getScrobbles("1month");

    expect(vi.mocked(cacheLife).mock.calls.slice(0, 16)).toEqual([
      ...Array.from({ length: 15 }, () => ["max"]),
      ["days"],
    ]);
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

describe("getScrobbleMonths", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T09:15:00Z"));
    vi.mocked(countScrobbles).mockResolvedValue(42);
  });

  it("should count every month since the first year's January", async () => {
    const result = await getScrobbleMonths();

    expect(countScrobbles).toHaveBeenCalledTimes((2026 - 2007) * 12 + 10);
    expect(result).toMatchObject({
      status: "ok",
      scrobbles: expect.arrayContaining([
        { label: "Jan 2007", count: 42, current: false },
        { label: "Oct 2026", count: 42, current: true },
      ]),
    });
  });
});

describe("getDailyScrobbles", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T09:15:00Z"));
    vi.mocked(countScrobbles).mockResolvedValue(42);
  });

  it("should count a past month's days, kept for good", async () => {
    const result = await getDailyScrobbles("2012-10");

    expect(countScrobbles).toHaveBeenCalledTimes(31);
    expect(cacheLife).toHaveBeenLastCalledWith("max");
    expect(result).toMatchObject({
      status: "ok",
      scrobbles: expect.arrayContaining([
        { label: "Oct 31", count: 42, current: false },
      ]),
    });
  });

  it("should regenerate a month that ended within the hour once it settles", async () => {
    vi.setSystemTime(new Date("2026-10-31T23:30:00Z"));

    await getDailyScrobbles("2026-10");

    expect(cacheLife).toHaveBeenLastCalledWith({
      stale: 300,
      revalidate: 1800,
      expire: 1800 + 86_400,
    });
  });

  it("should refuse a month outside the history without querying", async () => {
    const result = await getDailyScrobbles("2026-11");

    expect(result).toEqual({
      status: "error",
      error: "Failed to fetch scrobbles",
    });
    expect(countScrobbles).not.toHaveBeenCalled();
    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("seconds");
  });

  it("should return error status when a count fails", async () => {
    const mockError = new Error("Database error");
    vi.mocked(countScrobbles).mockRejectedValue(mockError);

    const result = await getDailyScrobbles("2026-10");

    expect(result).toEqual({
      status: "error",
      error: "Failed to fetch scrobbles",
    });
    expect(log.error).toHaveBeenCalledWith(
      { err: mockError, action: "getDailyScrobbles" },
      "Error fetching scrobbles",
    );
  });
});

describe("getDayPlays", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T09:15:00Z"));
  });

  it("should list the Stockholm day's plays with their wall-clock time", async () => {
    vi.mocked(playsIn).mockResolvedValue([
      {
        playedAt: new Date("2012-10-14T14:27:43Z"),
        artist: "The Magnetic Fields",
        track: "Old Fools",
      },
    ]);

    const result = await getDayPlays("2012-10-14");

    expect(playsIn).toHaveBeenCalledExactlyOnceWith(
      new Date("2012-10-13T22:00:00Z"),
      new Date("2012-10-14T22:00:00Z"),
    );
    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("max");
    expect(result).toEqual({
      status: "ok",
      plays: [
        { name: "Old Fools", artist: "The Magnetic Fields", time: "16:27" },
      ],
    });
  });

  it("should reread today's plays every few minutes", async () => {
    vi.mocked(playsIn).mockResolvedValue([]);

    await getDayPlays("2026-10-23");

    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("minutes");
  });

  it("should refuse a day outside the history without querying", async () => {
    const result = await getDayPlays("2026-10-24");

    expect(result).toMatchObject({ status: "error" });
    expect(playsIn).not.toHaveBeenCalled();
  });

  it("should return error status when the query fails", async () => {
    const mockError = new Error("Database error");
    vi.mocked(playsIn).mockRejectedValue(mockError);

    const result = await getDayPlays("2012-10-14");

    expect(result).toEqual({
      status: "error",
      error: "Failed to fetch the day's plays",
    });
    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("seconds");
    expect(log.error).toHaveBeenCalledWith(
      { err: mockError, action: "getDayPlays", date: "2012-10-14" },
      "Error fetching day plays",
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
  const played = (artist: string, track: string) => ({
    playedAt: new Date(0),
    artist,
    track,
  });

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
