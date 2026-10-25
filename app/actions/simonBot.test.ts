import { cacheLife } from "next/cache";
import { describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { forgetPerson, readPersonNotes, readPublicNotes } from "@/lib/memory";
import type { Username } from "@/lib/session";

import { forgetMe, getBotNotes, getNotesOnMe } from "./simonBot";

vi.mock(import("@/lib/memory"), () => ({
  forgetPerson: vi.fn(),
  readPersonNotes: vi.fn(),
  readPublicNotes: vi.fn(),
}));

vi.mock(import("next/cache"), () => ({ cacheLife: vi.fn() }));

vi.mock(import("@/lib/session"), () => ({
  getSession: vi.fn(() =>
    Promise.resolve({ username: "brave-otter" as Username }),
  ),
}));

describe("getBotNotes", () => {
  it("should return the notes and cache them for minutes", async () => {
    const notes = { self: [], style: [], interests: [] };
    vi.mocked(readPublicNotes).mockResolvedValue(notes);

    await expect(getBotNotes()).resolves.toEqual({ status: "ok", data: notes });
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
  it("should return the visitor's name and the bot's notes on them", async () => {
    vi.mocked(readPersonNotes).mockResolvedValue([
      {
        id: 1,
        category: "people/brave-otter",
        content: "likes jazz",
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: undefined,
      },
    ]);

    await expect(getNotesOnMe()).resolves.toEqual({
      status: "ok",
      data: { username: "brave-otter", notes: ["likes jazz"] },
    });
    expect(readPersonNotes).toHaveBeenCalledExactlyOnceWith("brave-otter");
  });

  it("should return an error when the read fails", async () => {
    const err = new Error("boom");
    vi.mocked(readPersonNotes).mockRejectedValue(err);

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
  it("should forget the visitor and count the notes", async () => {
    vi.mocked(forgetPerson).mockResolvedValue(2);

    await expect(forgetMe()).resolves.toEqual({
      status: "ok",
      data: { forgotten: 2 },
    });
    expect(forgetPerson).toHaveBeenCalledExactlyOnceWith("brave-otter");
  });

  it("should return an error when the delete fails", async () => {
    const err = new Error("boom");
    vi.mocked(forgetPerson).mockRejectedValue(err);

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
