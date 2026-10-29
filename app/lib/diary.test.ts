import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildSystem,
  LISTENING_TOOLS,
  type LoopEnd,
  runAgentLoop,
} from "@/lib/anthropic";
import type { DayFacts } from "@/lib/diaryFacts";
import { tryLock } from "@/lib/locks";
import { BOOTSTRAP, MIGRATIONS } from "@/lib/migrations";
import { query } from "@/lib/turso";
import { sqliteBeforeEach } from "@/mocks/sqlite";

import { readEntries, writeEntry, writeYesterday } from "./diary";

vi.mock(import("@/lib/turso"), async () =>
  (await import("@/mocks/sqlite")).mockTurso(),
);

vi.mock(import("@/lib/anthropic"), async (importOriginal) => ({
  ...(await importOriginal()),
  runAgentLoop: vi.fn(),
  buildSystem: vi.fn(async () => [{ type: "text" as const, text: "prompt" }]),
}));

vi.mock(import("@/lib/diaryFacts"), () => ({
  dayFacts: vi.fn(async (): Promise<DayFacts> => ({
    day: "Tue, Oct 27, 2026",
    plays: 1,
    typicalPlays: 40,
    topArtists: [{ artist: "Smog", plays: 1 }],
    repeats: [],
    firstTimeArtists: [],
    returningArtists: [],
    hours: [{ hour: "23", plays: 1, typical: 2 }],
  })),
}));

vi.mock(import("@/lib/locks"), async (importOriginal) => ({
  ...(await importOriginal()),
  tryLock: vi.fn(async () => true),
}));

sqliteBeforeEach(query, [...BOOTSTRAP, ...MIGRATIONS]);

function replies(texts: string[], end: LoopEnd = "end_turn") {
  vi.mocked(runAgentLoop).mockImplementation(async function* () {
    yield* texts;
    return end;
  });
}

const entry = (day: string, text: string) =>
  query("INSERT INTO diary VALUES (?, ?, 0)", [day, text]);

const stored = async () =>
  (await query("SELECT day, entry FROM diary ORDER BY day")).rows;

describe("writeEntry", () => {
  it("should write from the day's facts and the latest entries", async () => {
    await entry("2026-10-25", "a <quiet> one");
    await entry("2026-10-26", "");
    replies(["let me check", "smog, once, at 23:00"]);

    await expect(writeEntry("2026-10-27")).resolves.toBe(
      "smog, once, at 23:00",
    );

    expect(buildSystem).toHaveBeenCalledWith(
      expect.stringContaining("diary"),
      [],
    );
    const [options] = vi.mocked(runAgentLoop).mock.calls[0] ?? [];
    expect(options).toMatchObject({ tools: LISTENING_TOOLS, loop: "diary" });
    expect(options?.messages[0]?.content).toMatch(
      /<entry day="2026-10-25">a &lt;quiet&gt; one<\/entry>\n<\/recent_entries>\n<day date="2026-10-27">\n\{"day":"Tue, Oct 27, 2026"/,
    );
  });

  it("should skip a day the bot has nothing to say about", async () => {
    replies(["Nothing."]);

    await expect(writeEntry("2026-10-27")).resolves.toBe("");
  });

  it("should fail when the bot is cut off", async () => {
    replies(["smog, on"], "max_tokens");

    await expect(writeEntry("2026-10-27")).rejects.toThrow(
      "Diary entry ended in max_tokens",
    );
  });
});

describe("readEntries", () => {
  it("should list the newest written entries", async () => {
    await entry("2026-10-25", "first");
    await entry("2026-10-26", "");
    await entry("2026-10-27", "second");
    await entry("2026-10-28", "third");

    await expect(readEntries(2)).resolves.toEqual([
      { day: "2026-10-28", entry: "third" },
      { day: "2026-10-27", entry: "second" },
    ]);
  });
});

describe("writeYesterday", () => {
  // 00:20 on October 28th in Stockholm.
  const NOW = new Date("2026-10-27T23:20:00Z");

  beforeEach(() => {
    replies(["smog, once"]);
  });

  it("should store yesterday's entry once", async () => {
    await writeYesterday(NOW);
    await writeYesterday(NOW);

    expect(runAgentLoop).toHaveBeenCalledOnce();
    expect(await stored()).toEqual([
      { day: "2026-10-27", entry: "smog, once" },
    ]);
  });

  it("should wait for the day's last plays to sync", async () => {
    await writeYesterday(new Date("2026-10-27T23:05:00Z"));

    expect(runAgentLoop).not.toHaveBeenCalled();
  });

  it("should leave the entry to the replica holding the lock", async () => {
    vi.mocked(tryLock).mockResolvedValue(false);

    await writeYesterday(NOW);

    expect(runAgentLoop).not.toHaveBeenCalled();
  });

  it("should give up on a day after three failed tries", async () => {
    replies([], "refusal");

    for (let i = 0; i < 3; i++) {
      await expect(writeYesterday(NOW)).rejects.toThrow();
    }
    await writeYesterday(NOW);

    expect(runAgentLoop).toHaveBeenCalledTimes(3);
    expect(await stored()).toEqual([]);
  });
});
