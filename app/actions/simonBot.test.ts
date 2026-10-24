import { cacheLife } from "next/cache";
import { describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { readPublicNotes } from "@/lib/memory";
import { MIGRATIONS } from "@/lib/migrations";
import { getSession, type Username } from "@/lib/session";
import { query } from "@/lib/turso";
import { seed, stored } from "@/mocks/memory";
import { sqliteBeforeEach } from "@/mocks/sqlite";

import { forgetMe, getBotNotes, getNotesOnMe } from "./simonBot";

vi.mock(import("@/lib/memory"), async (importOriginal) => ({
  ...(await importOriginal()),
  readPublicNotes: vi.fn(),
}));

vi.mock(import("next/cache"), () => ({ cacheLife: vi.fn() }));

vi.mock(import("@/lib/session"), () => ({
  getSession: vi.fn(() =>
    Promise.resolve({ username: "brave-otter" as Username }),
  ),
}));

vi.mock(import("@/lib/turso"), async () =>
  (await import("@/mocks/sqlite")).mockTurso(),
);

sqliteBeforeEach(query, MIGRATIONS);

describe("getBotNotes", () => {
  it("should return the notes and cache them for minutes", async () => {
    const notes = { self: [], style: [], interests: [] };
    vi.mocked(readPublicNotes).mockResolvedValue(notes);

    await expect(getBotNotes()).resolves.toEqual({ status: "ok", notes });
    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("minutes");
  });

  it("should return an error and cache it briefly when the read fails", async () => {
    const err = new Error("boom");
    vi.mocked(readPublicNotes).mockRejectedValue(err);

    await expect(getBotNotes()).resolves.toEqual({
      status: "error",
      error: "Failed to fetch bot notes",
    });
    expect(log.error).toHaveBeenCalledWith(
      { err, action: "getBotNotes" },
      "Error fetching bot notes",
    );
    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("seconds");
  });
});

describe("getNotesOnMe", () => {
  it("should return the visitor's name and the bot's notes on them, oldest first", async () => {
    await seed(1, "people/brave-otter", "likes jazz", "2026-10-01T00:00:00Z");
    await seed(
      2,
      "people/brave-otter",
      "lives in oslo",
      "2026-10-02T00:00:00Z",
    );
    await seed(3, "people/calm-yak", "likes cats");

    await expect(getNotesOnMe()).resolves.toEqual({
      status: "ok",
      data: { username: "brave-otter", notes: ["likes jazz", "lives in oslo"] },
    });
  });

  it("should return an error when the read fails", async () => {
    const err = new Error("boom");
    vi.mocked(query).mockRejectedValue(err);

    await expect(getNotesOnMe()).resolves.toEqual({
      status: "error",
      error: "Failed to fetch simon-bot's notes",
    });
    expect(log.error).toHaveBeenCalledWith(
      { err, action: "getNotesOnMe" },
      "Error fetching notes on me",
    );
  });
});

describe("forgetMe", () => {
  it("should delete only the visitor's notes and count them", async () => {
    await seed(1, "people/brave-otter", "likes jazz");
    await seed(2, "people/calm-yak", "likes cats");

    await expect(forgetMe()).resolves.toEqual({
      status: "ok",
      data: { forgotten: 1 },
    });
    expect(await stored(1)).toBeUndefined();
    expect(await stored(2)).toBeDefined();
  });

  it("should return an error when it fails", async () => {
    const err = new Error("boom");
    vi.mocked(getSession).mockRejectedValue(err);

    await expect(forgetMe()).resolves.toEqual({
      status: "error",
      error: "Failed to forget simon-bot's notes",
    });
    expect(log.error).toHaveBeenCalledWith(
      { err, action: "forgetMe" },
      "Error forgetting notes on me",
    );
  });
});
