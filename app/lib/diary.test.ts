import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildSystem,
  CHAT_TOOLS,
  LISTENING_TOOLS,
  type LoopEnd,
  runAgentLoop,
} from "@/lib/anthropic";
import { releaseLock, tryLock } from "@/lib/locks";
import { log } from "@/lib/log";
import { PUBLIC_CATEGORIES } from "@/lib/memory";
import { BOOTSTRAP, MIGRATIONS } from "@/lib/migrations";
import { query } from "@/lib/turso";
import { sqliteBeforeEach } from "@/mocks/sqlite";

import { readEntries, startDiary, writeEntry, writeYesterday } from "./diary";

vi.mock(import("@/lib/turso"), async () =>
  (await import("@/mocks/sqlite")).mockTurso(),
);

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
  it("should write from its tools and the latest entries", async () => {
    await entry("2026-10-25", "a <quiet> one");
    await entry("2026-10-26", "");
    replies(["let me check", "smog, once, at 23:00"]);

    await expect(writeEntry("2026-10-27")).resolves.toBe(
      "smog, once, at 23:00",
    );

    expect(buildSystem).toHaveBeenCalledWith(
      expect.stringContaining("diary"),
      [],
      PUBLIC_CATEGORIES,
    );
    const [options] = vi.mocked(runAgentLoop).mock.calls[0] ?? [];
    expect(options).toMatchObject({
      tools: [...LISTENING_TOOLS, ...CHAT_TOOLS],
      loop: "diary",
    });
    expect(options?.messages[0]?.content).toMatch(
      /<entry day="2026-10-25">a &lt;quiet&gt; one<\/entry>\n<\/recent_entries>\n<yesterday date="2026-10-27">Tue, Oct 27, 2026<\/yesterday>/,
    );
  });

  it("should skip a day the bot has nothing to say about", async () => {
    replies(["Nothing."]);

    await expect(writeEntry("2026-10-27")).resolves.toBe("");
  });

  it("should fail when the bot is cut off", async () => {
    replies(["smog, on"], "max_tokens");

    await expect(writeEntry("2026-10-27")).rejects.toThrow(
      "Diary entry ended in max_tokens with 8 characters",
    );
  });

  it("should fail when the bot ends without an entry", async () => {
    replies([]);

    await expect(writeEntry("2026-10-27")).rejects.toThrow(
      "Diary entry ended in end_turn with 0 characters",
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

  it("should leave an entry another replica wrote", async () => {
    await entry("2026-10-27", "theirs");

    await writeYesterday(NOW);

    expect(runAgentLoop).not.toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalled();
  });

  it("should warn when the lock isn't released", async () => {
    const err = new Error("boom");
    vi.mocked(releaseLock).mockRejectedValue(err);

    await writeYesterday(NOW);

    expect(await stored()).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith(
      { err },
      "Failed to release the diary lock",
    );
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

describe("startDiary", () => {
  it("should log a failed check and check again ten minutes later", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-27T23:20:00Z") });
    const err = new Error("boom");
    vi.mocked(tryLock).mockRejectedValueOnce(err);

    startDiary();
    await vi.waitFor(() =>
      expect(log.warn).toHaveBeenCalledWith(
        { err },
        "Failed to write simon-bot's diary",
      ),
    );
    expect(runAgentLoop).not.toHaveBeenCalled();

    replies(["smog, once"]);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(runAgentLoop).toHaveBeenCalledOnce();
  });
});
