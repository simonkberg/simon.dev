// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { userGetLovedTracks, userGetScrobbles } from "@/lib/lastfm";
import { log } from "@/lib/log";
import { BOOTSTRAP, MIGRATIONS } from "@/lib/migrations";
import { batch, query } from "@/lib/turso";
import { sqliteBeforeEach } from "@/mocks/sqlite";

import {
  countScrobbles,
  playsIn,
  startScrobbleSync,
  syncScrobbles,
  topArtist,
  topPlayed,
} from "./scrobbles";

vi.mock(import("@/lib/turso"), async () =>
  (await import("@/mocks/sqlite")).mockTurso(),
);

vi.mock(import("@/lib/lastfm"), async (importOriginal) => ({
  ...(await importOriginal()),
  userGetLovedTracks: vi.fn(async () => ({ totalPages: 1, tracks: [] })),
  userGetScrobbles: vi.fn(),
}));

sqliteBeforeEach(query, [...BOOTSTRAP, ...MIGRATIONS]);

const NOW = Date.UTC(2026, 9, 27);

// Last.fm's history, one scrobble a minute up to `NOW`.
let lastfm: number[];

function scrobble(playedAt: number) {
  return {
    name: `Track ${playedAt}`,
    artist: "Artist",
    album: "Album",
    playedAt: new Date(playedAt),
    nowPlaying: false,
    loved: false,
  };
}

function played(count: number, until = NOW) {
  return Array.from({ length: count }, (_, i) => until - i * 60_000);
}

// Newest first, `from` inclusive and `to` exclusive by the second, as Last.fm pages a range.
const fakeLastfm: typeof userGetScrobbles = async (
  _user,
  { from, to, limit, page = 1 },
) => {
  const inRange = lastfm
    .filter((at) => at >= from.getTime() && at < to.getTime())
    .toSorted((a, b) => b - a);
  return {
    total: inRange.length,
    tracks: inRange.slice((page - 1) * limit, page * limit).map(scrobble),
  };
};

async function stored(): Promise<number[]> {
  const { rows } = await query(
    "SELECT played_at FROM scrobbles ORDER BY played_at DESC",
  );
  return rows.map((row) => Number(row["played_at"]));
}

describe("syncScrobbles", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW + 1000, toFake: ["Date"] });
    vi.mocked(userGetScrobbles).mockImplementation(fakeLastfm);
  });

  it("should backfill every scrobble, oldest last", async () => {
    lastfm = played(450);

    await expect(syncScrobbles()).resolves.toBe(false);

    expect(await stored()).toEqual(lastfm);
    expect(log.info).toHaveBeenCalledWith(
      { oldest: new Date(NOW - 449 * 60_000) },
      "Backfilled every scrobble",
    );
  });

  it("should keep backfilling past a short page", async () => {
    lastfm = played(450);
    vi.mocked(userGetScrobbles).mockImplementationOnce(async (...args) => {
      const page = await fakeLastfm(...args);
      return { ...page, tracks: page.tracks.slice(0, -1) };
    });

    await syncScrobbles();

    expect(await stored()).toEqual(lastfm);
  });

  it("should stop a backfill after its slice and resume it next time", async () => {
    lastfm = played(450);
    vi.mocked(userGetScrobbles).mockImplementationOnce(async (...args) => {
      vi.setSystemTime(Date.now() + 60_000);
      return fakeLastfm(...args);
    });

    await expect(syncScrobbles()).resolves.toBe(true);
    expect(await stored()).toHaveLength(200);

    await expect(syncScrobbles()).resolves.toBe(false);
    expect(await stored()).toEqual(lastfm);
  });

  it("should catch up on scrobbles since the newest stored", async () => {
    lastfm = played(50);
    await syncScrobbles();
    const newer = played(450, NOW + 450 * 60_000);
    lastfm = [...newer, ...lastfm];
    vi.setSystemTime(NOW + 451 * 60_000);

    await syncScrobbles();

    expect(await stored()).toEqual(lastfm);
  });

  it("should store a scrobble that arrives late with an older time", async () => {
    lastfm = played(50);
    await syncScrobbles();
    const late = NOW - 30_000;
    lastfm = [...lastfm, late].toSorted((a, b) => b - a);

    await syncScrobbles();

    expect(await stored()).toEqual(lastfm);
  });

  it("should fetch only what follows the newest stored for a new scrobble", async () => {
    lastfm = played(250);
    await syncScrobbles();
    lastfm = [NOW + 60_000, ...lastfm];
    vi.setSystemTime(NOW + 61_000);
    vi.mocked(userGetScrobbles).mockClear();

    await syncScrobbles();

    expect(await stored()).toEqual(lastfm);
    expect(userGetScrobbles).toHaveBeenCalledTimes(2);
  });

  it("should not refetch what storing can't settle, like a repeat in one second", async () => {
    lastfm = [NOW, ...played(250)];
    await syncScrobbles();
    await syncScrobbles();
    vi.mocked(userGetScrobbles).mockClear();

    await syncScrobbles();

    expect(userGetScrobbles).toHaveBeenCalledOnce();
  });

  it("should leave no gap below the newest stored when a catch-up fails", async () => {
    lastfm = played(50);
    await syncScrobbles();
    lastfm = [...played(450, NOW + 450 * 60_000), ...lastfm];
    vi.setSystemTime(NOW + 451 * 60_000);
    vi.mocked(userGetScrobbles).mockImplementation(async (user, params) => {
      if (params.page === 2) throw new Error("boom");
      return fakeLastfm(user, params);
    });

    await expect(syncScrobbles()).rejects.toThrow("boom");

    // Only the oldest page landed, right above what was already stored.
    expect(await stored()).toEqual(lastfm.slice(-100));
  });

  it("should leave the sync to the replica holding the lock", async () => {
    lastfm = played(10);
    await query("INSERT INTO locks VALUES ('scrobbles', 'other', ?)", [
      NOW + 60_000,
    ]);

    await expect(syncScrobbles()).resolves.toBe(false);

    expect(userGetScrobbles).not.toHaveBeenCalled();
  });
});

describe("syncScrobbles loved tracks", () => {
  const loved = (name: string, lovedAt = NOW) => ({
    name,
    artist: "Artist",
    lovedAt: new Date(lovedAt),
  });

  async function storedLoved() {
    const { rows } = await query(
      "SELECT track, loved_at FROM loved ORDER BY track",
    );
    return rows.map((row) => [row["track"], row["loved_at"]]);
  }

  beforeEach(async () => {
    lastfm = played(1);
    vi.mocked(userGetScrobbles).mockImplementation(fakeLastfm);
    // The backfill is done, so the loved tracks sync from here.
    await syncScrobbles();
    await query(
      "INSERT INTO loved VALUES ('Artist', 'Kept', ?), ('Artist', 'Unloved', ?), ('Artist', 'Loved again', ?)",
      [NOW, NOW, NOW],
    );
    vi.mocked(batch).mockClear();
  });

  it("should write only what changed in Last.fm's list, every page of it", async () => {
    vi.mocked(userGetLovedTracks).mockImplementation(
      async (_user, { page }) => ({
        totalPages: 2,
        tracks:
          page === 1
            ? [loved("Kept"), loved("Loved again", NOW + 1000)]
            : [loved("New")],
      }),
    );

    await syncScrobbles();

    expect(await storedLoved()).toEqual([
      ["Kept", NOW],
      ["Loved again", NOW + 1000],
      ["New", NOW],
    ]);
    expect(batch).toHaveBeenCalledOnce();
    expect(vi.mocked(batch).mock.calls[0]?.[0]).toHaveLength(3);
  });

  it("should remove what was unloved on Last.fm", async () => {
    vi.mocked(userGetLovedTracks).mockResolvedValue({
      totalPages: 1,
      tracks: [loved("Kept"), loved("Loved again")],
    });

    await syncScrobbles();

    expect(await storedLoved()).toEqual([
      ["Kept", NOW],
      ["Loved again", NOW],
    ]);
  });

  it("should write nothing while Last.fm lists the same", async () => {
    vi.mocked(userGetLovedTracks).mockResolvedValue({
      totalPages: 1,
      tracks: [loved("Kept"), loved("Unloved"), loved("Loved again")],
    });

    await syncScrobbles();

    expect(batch).not.toHaveBeenCalled();
  });

  it("should still sync scrobbles when the loved tracks fail", async () => {
    const err = new Error("boom");
    vi.mocked(userGetLovedTracks).mockRejectedValue(err);

    await expect(syncScrobbles()).resolves.toBe(false);

    expect(log.warn).toHaveBeenCalledWith(
      { err },
      "Failed to sync loved tracks",
    );
  });
});

describe("startScrobbleSync", () => {
  it("should log a failed sync and try again a minute later", async () => {
    vi.useFakeTimers({ now: NOW });
    vi.mocked(query).mockRejectedValueOnce(new Error("boom"));
    lastfm = [];
    vi.mocked(userGetScrobbles).mockImplementation(fakeLastfm);

    startScrobbleSync();
    await vi.waitFor(() =>
      expect(log.warn).toHaveBeenCalledWith(
        { err: new Error("boom") },
        "Failed to sync scrobbles",
      ),
    );
    expect(userGetScrobbles).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(userGetScrobbles).toHaveBeenCalled();
  });

  it("should sync again straight away while history remains", async () => {
    vi.useFakeTimers({ now: NOW + 1000 });
    lastfm = played(450);
    // Each request outlasts a backfill slice, so every sync stores one page.
    vi.mocked(userGetScrobbles).mockImplementation(async (...args) => {
      vi.setSystemTime(Date.now() + 60_000);
      return fakeLastfm(...args);
    });

    startScrobbleSync();

    await vi.waitFor(async () => expect(await stored()).toEqual(lastfm));
  });
});

describe("countScrobbles", () => {
  it("should count from `from` until `to`", async () => {
    await query(
      `INSERT INTO scrobbles VALUES
       (999, 'A', 'T', ''), (1000, 'A', 'T', ''), (1999, 'B', 'T', ''), (2000, 'A', 'T', '')`,
    );

    await expect(countScrobbles(new Date(1000), new Date(2000))).resolves.toBe(
      2,
    );
  });
});

describe("playsIn", () => {
  it("should list what played from `from` until `to`, oldest first", async () => {
    await query(
      `INSERT INTO scrobbles VALUES
       (2000, 'C', 'V', ''), (1000, 'A', 'T', ''), (999, 'Z', 'Z', ''), (1500, 'B', 'U', '')`,
    );

    await expect(playsIn(new Date(1000), new Date(2000))).resolves.toEqual([
      { artist: "A", track: "T" },
      { artist: "B", track: "U" },
    ]);
  });
});

describe("topPlayed", () => {
  beforeEach(async () => {
    await query(
      `INSERT INTO scrobbles VALUES
       (1, 'B', 'X', 'Two'), (2, 'B', 'Y', 'Two'), (3, 'A', 'X', 'One'),
       (4, 'A', 'X', 'One'), (5, 'A', 'Y', ''), (6, 'A', 'Y', ''), (7, 'C', 'Z', 'Late')`,
    );
  });

  it.each([
    [
      "artist",
      [
        { name: "A", artist: "A", playcount: 4 },
        { name: "B", artist: "B", playcount: 2 },
      ],
    ],
    [
      "track",
      [
        { name: "X", artist: "A", playcount: 2 },
        { name: "Y", artist: "A", playcount: 2 },
      ],
    ],
    // A play without an album counts toward no album.
    [
      "album",
      [
        { name: "One", artist: "A", playcount: 2 },
        { name: "Two", artist: "B", playcount: 2 },
      ],
    ],
  ] as const)(
    "should rank each %s from `from` until `to`, ties by artist, then title",
    async (kind, top) => {
      await expect(
        topPlayed(kind, new Date(0), new Date(7), 2),
      ).resolves.toEqual(top);
    },
  );
});

describe("topArtist", () => {
  it("should pick the most played artist, first by name on a tie", async () => {
    await query(
      `INSERT INTO scrobbles VALUES
       (1, 'B', 'T', ''), (2, 'C', 'T', ''), (3, 'C', 'U', ''),
       (4, 'B', 'U', ''), (5, 'D', 'T', ''), (6, 'D', 'U', ''), (7, 'D', 'V', '')`,
    );

    await expect(topArtist(new Date(0), new Date(5))).resolves.toEqual({
      name: "B",
      playcount: 2,
    });
  });

  it("should find no artist where nothing played", async () => {
    await expect(
      topArtist(new Date(0), new Date(1000)),
    ).resolves.toBeUndefined();
  });
});
