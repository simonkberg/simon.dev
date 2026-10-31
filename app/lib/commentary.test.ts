import { cacheLife } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getDayPlays,
  getScrobbles,
  getTopArtistByBucket,
  getTopArtists,
  getTopTracks,
} from "@/actions/listening";
import {
  buildSystem,
  LISTENING_TOOLS,
  type LoopEnd,
  runAgentLoop,
} from "@/lib/anthropic";
import { releaseLock, tryLock } from "@/lib/locks";
import { PUBLIC_CATEGORIES } from "@/lib/memory";
import { BOOTSTRAP, MIGRATIONS } from "@/lib/migrations";
import { query } from "@/lib/turso";
import { sqliteBeforeEach } from "@/mocks/sqlite";

import {
  getCommentary,
  parsePage,
  slotOf,
  writeCommentary,
} from "./commentary";

vi.mock(import("@/lib/turso"), async () =>
  (await import("@/mocks/sqlite")).mockTurso(),
);

vi.mock(import("next/cache"), () => ({ cacheLife: vi.fn() }));

vi.mock(import("@/lib/anthropic"), async (importOriginal) => ({
  ...(await importOriginal()),
  runAgentLoop: vi.fn(),
  buildSystem: vi.fn(async () => [{ type: "text" as const, text: "prompt" }]),
}));

vi.mock(import("@/lib/locks"), async (importOriginal) => ({
  ...(await importOriginal()),
  tryLock: vi.fn(async () => true),
  releaseLock: vi.fn(async () => {}),
}));

vi.mock(import("@/actions/listening"), () => ({
  getScrobbles: vi.fn(async () => ({
    status: "ok" as const,
    scrobbles: [
      { label: "Oct 25", count: 237, current: false },
      { label: "Oct 31", count: 3, current: true },
    ],
  })),
  getTopArtistByBucket: vi.fn(async () => ({
    status: "ok" as const,
    buckets: [
      {
        label: "Oct 25",
        artist: { name: "The Mountain Goats", playcount: 90 },
      },
      { label: "Oct 31", artist: undefined },
    ],
  })),
  getTopTracks: vi.fn(async () => ({
    status: "ok" as const,
    tracks: [{ rank: 1, name: "Bones", artist: "Frog", playcount: 8 }],
  })),
  getTopArtists: vi.fn(async () => ({
    status: "ok" as const,
    artists: [{ rank: 1, name: "Frog & Toad", playcount: 76 }],
  })),
  getTopAlbums: vi.fn(async () => ({
    status: "error" as const,
    error: "Failed to fetch top albums",
  })),
  getOnThisDay: vi.fn(async () => ({
    status: "ok" as const,
    days: {
      date: "Oct 31",
      years: [
        {
          year: "2025",
          day: "2025-10-31" as const,
          count: 35,
          top: { artist: "Black Country, New Road", track: "Snow Globes" },
        },
        { year: "2024", day: "2024-10-31" as const, count: 0 },
      ],
    },
  })),
  getDayPlays: vi.fn(async () => ({
    status: "ok" as const,
    plays: [
      { time: "00:05", name: "I'm Jim Morrison, I'm Dead", artist: "Mogwai" },
    ],
  })),
}));

sqliteBeforeEach(query, [...BOOTSTRAP, ...MIGRATIONS]);

// Noon on Saturday, October 31st, in Stockholm.
const NOW = new Date("2026-10-31T11:00:00Z");

function replies(texts: string[], end: LoopEnd = "end_turn") {
  vi.mocked(runAgentLoop).mockImplementation(async function* () {
    yield* texts;
    return end;
  });
}

const store = (page: string, slot: string, text: string, version = 1) =>
  query("INSERT INTO commentary VALUES (?, ?, ?, ?, 0)", [
    page,
    slot,
    version,
    text,
  ]);

const stored = async () =>
  (await query("SELECT page, slot, text FROM commentary ORDER BY slot")).rows;

function input(): string {
  const content =
    vi.mocked(runAgentLoop).mock.calls[0]?.[0].messages[0]?.content;
  return typeof content === "string" ? content : "";
}

describe("parsePage", () => {
  it.each([
    ["7day", "7day"],
    ["on-this-day", "on-this-day"],
    ["2019-03-04", "2019-03-04"],
    ["2026-11-01", undefined],
    ["yesterday", undefined],
    [null, undefined],
  ])("should read %s as %s", (value, page) => {
    expect(parsePage(value, "2026-10-31")).toBe(page);
  });
});

describe("slotOf", () => {
  it.each([
    ["7day", "7day", "2026-10-31", "2026-10-31T23:00:00Z"],
    ["on-this-day", "on-this-day", "2026-10-31", "2026-10-31T23:00:00Z"],
    // The week starts on Monday, and ends after summer time does.
    ["1month", "1month", "2026-10-26", "2026-11-01T23:00:00Z"],
    ["12month", "12month", "2026-10", "2026-10-31T23:00:00Z"],
    ["2019-03-04", "day", "2019-03-04", undefined],
  ] as const)("should give %s its slot", (page, key, slot, end) => {
    expect(slotOf(page, NOW)).toEqual({
      page: key,
      slot,
      end: end === undefined ? undefined : new Date(end),
    });
  });

  it("should leave a day without a slot while its plays come in", () => {
    // 00:30 on November 1st: the 31st ended half an hour ago.
    expect(
      slotOf("2026-10-31", new Date("2026-10-31T23:30:00Z")),
    ).toBeUndefined();
  });
});

describe("getCommentary", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });

  it("should keep the slot's comment until the slot ends", async () => {
    await store("7day", "2026-10-30", "yesterday's");
    await store("7day", "2026-10-31", "today's");

    await expect(getCommentary("7day")).resolves.toEqual({
      status: "ok",
      text: "today's",
    });
    expect(cacheLife).toHaveBeenCalledWith(
      expect.objectContaining({ revalidate: 12 * 60 * 60 }),
    );
  });

  it("should keep a day's comment for good", async () => {
    await store("day", "2019-03-04", "mogwai monday");

    await expect(getCommentary("2019-03-04")).resolves.toEqual({
      status: "ok",
      text: "mogwai monday",
    });
    expect(cacheLife).toHaveBeenCalledWith("max");
  });

  it("should reread soon when none matches the prompt's version", async () => {
    await store("7day", "2026-10-31", "old prompt", 0);

    await expect(getCommentary("7day")).resolves.toEqual({
      status: "ok",
      text: undefined,
    });
    expect(cacheLife).toHaveBeenCalledWith("seconds");
  });

  it("should return an error when the read fails", async () => {
    vi.mocked(query).mockRejectedValueOnce(new Error("down"));

    await expect(getCommentary("7day")).resolves.toEqual({
      status: "error",
      error: "Failed to read commentary",
    });
    expect(cacheLife).toHaveBeenCalledWith("seconds");
  });
});

describe("writeCommentary", () => {
  beforeEach(() => {
    replies(["frog ate the week"]);
  });

  it("should write a period's comment from its page and the last one", async () => {
    await store("7day", "2026-10-30", "goats <again>");

    await expect(writeCommentary("7day", NOW)).resolves.toBe(
      "frog ate the week",
    );

    expect(buildSystem).toHaveBeenCalledWith(
      expect.stringContaining("comment"),
      PUBLIC_CATEGORIES,
      false,
    );
    expect(vi.mocked(runAgentLoop).mock.calls[0]?.[0]).toMatchObject({
      tools: LISTENING_TOOLS,
      endInText: true,
      loop: "commentary",
    });
    expect(input()).toContain(
      `<page description="Simon's last 7 days, today being Sat, Oct 31, 2026: scrobbles over time, with each bar's top artist, then his tops.">
<scrobbles>
Oct 25: 237, mostly The Mountain Goats
Oct 31: 3 (so far)
</scrobbles>
<top_tracks>
1. Bones - Frog: 8
</top_tracks>
<top_artists>
1. Frog &amp; Toad: 76
</top_artists>
</page>
<previous>goats &lt;again&gt;</previous>`,
    );
    expect(await stored()).toEqual([
      { page: "7day", slot: "2026-10-30", text: "goats <again>" },
      { page: "7day", slot: "2026-10-31", text: "frog ate the week" },
    ]);
    expect(releaseLock).toHaveBeenCalledWith(
      "commentary:7day/2026-10-31",
      vi.mocked(tryLock).mock.calls[0]?.[1],
    );
  });

  it("should describe all time by its own words", async () => {
    await writeCommentary("overall", NOW);

    expect(input()).toContain(
      "<page description=\"all of Simon's listening, today being",
    );
  });

  it("should write On this day from its years", async () => {
    await writeCommentary("on-this-day", NOW);

    expect(input()).toContain(`<years date="Oct 31">
2025: 35 plays, mostly Snow Globes - Black Country, New Road
2024: nothing played
</years>`);
  });

  it("should write a day from its plays and month, without another day's comment", async () => {
    await store("day", "2019-03-03", "sunday");

    await writeCommentary("2019-03-04", NOW);

    expect(getDayPlays).toHaveBeenCalledWith("2019-03-04");
    expect(getTopTracks).toHaveBeenCalledWith("2019-03");
    expect(input()).toContain(`<plays>
00:05 I'm Jim Morrison, I'm Dead - Mogwai
</plays>
<month_tops>`);
    expect(input()).not.toContain("<previous>");
  });

  it("should replace a comment from an older prompt", async () => {
    await store("7day", "2026-10-31", "old prompt", 0);

    await writeCommentary("7day", NOW);

    expect(await stored()).toEqual([
      { page: "7day", slot: "2026-10-31", text: "frog ate the week" },
    ]);
  });

  it("should return the comment another request stored before the lock", async () => {
    await store("7day", "2026-10-31", "already here");

    await expect(writeCommentary("7day", NOW)).resolves.toBe("already here");
    expect(runAgentLoop).not.toHaveBeenCalled();
  });

  it("should wait for the request holding the lock", async () => {
    vi.useFakeTimers();
    vi.mocked(tryLock).mockResolvedValueOnce(false);

    const written = writeCommentary("7day", NOW);
    await vi.advanceTimersByTimeAsync(1000);
    await store("7day", "2026-10-31", "theirs");
    await vi.advanceTimersByTimeAsync(1000);

    await expect(written).resolves.toBe("theirs");
    expect(runAgentLoop).not.toHaveBeenCalled();
  });

  it("should write nothing for a day whose plays are still coming in", async () => {
    await expect(writeCommentary("2026-10-31", NOW)).resolves.toBeUndefined();
    expect(tryLock).not.toHaveBeenCalled();
  });

  it("should take only the last turn's text", async () => {
    vi.mocked(runAgentLoop).mockImplementation(async function* ({ messages }) {
      yield "let me check";
      messages.push({ role: "assistant", content: [] });
      yield "frog.";
      yield "again.";
      return "end_turn";
    });

    await expect(writeCommentary("7day", NOW)).resolves.toBe("frog. again.");
  });

  it("should fail and release the lock when the bot is cut off", async () => {
    replies(["frog ate"], "max_tokens");

    await expect(writeCommentary("7day", NOW)).rejects.toThrow(
      "Commentary ended in max_tokens with 8 characters",
    );
    expect(releaseLock).toHaveBeenCalled();
    expect(await stored()).toEqual([]);
  });
});

describe("page facts", () => {
  it("should leave out what failed to load", async () => {
    vi.mocked(getScrobbles).mockResolvedValueOnce({
      status: "error",
      error: "down",
    });
    vi.mocked(getTopArtistByBucket).mockResolvedValueOnce({
      status: "error",
      error: "down",
    });
    vi.mocked(getTopArtists).mockResolvedValueOnce({
      status: "error",
      error: "down",
    });
    replies(["hm"]);

    await writeCommentary("7day", NOW);

    expect(input()).not.toContain("<scrobbles>");
    expect(input()).not.toContain("<top_artists>");
  });
});
