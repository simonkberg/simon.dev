import { cacheLife } from "next/cache";
import { describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { readPublicNotes } from "@/lib/memory";

import { getBotNotes } from "./simonBot";

vi.mock(import("@/lib/memory"), () => ({ readPublicNotes: vi.fn() }));

vi.mock(import("next/cache"), () => ({ cacheLife: vi.fn() }));

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
