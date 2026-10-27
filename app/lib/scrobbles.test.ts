// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { userGetScrobbles } from "@/lib/lastfm";
import { log } from "@/lib/log";
import { BOOTSTRAP, MIGRATIONS } from "@/lib/migrations";
import { query } from "@/lib/turso";
import { sqliteBeforeEach } from "@/mocks/sqlite";

import { startScrobbleSync, syncScrobbles } from "./scrobbles";

vi.mock(import("@/lib/turso"), async () =>
  (await import("@/mocks/sqlite")).mockTurso(),
);

vi.mock(import("@/lib/lastfm"), async (importOriginal) => ({
  ...(await importOriginal()),
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

  it("should ask Last.fm once when nothing changed", async () => {
    lastfm = played(50);
    await syncScrobbles();
    vi.mocked(userGetScrobbles).mockClear();

    await syncScrobbles();

    expect(userGetScrobbles).toHaveBeenCalledOnce();
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
