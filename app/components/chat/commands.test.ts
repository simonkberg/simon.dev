import { afterEach, describe, expect, it, vi } from "vitest";

import { getArtistPlays, getRandomTrack } from "@/actions/lastfm";
import { forgetMe, getNotesOnMe } from "@/actions/simonBot";
import type { Username } from "@/lib/session";
import { resetPreferences } from "@/mocks/preferences";

import { runCommand } from "./commands";

vi.mock(import("@/actions/lastfm"), () => ({
  getArtistPlays: vi.fn(),
  getRandomTrack: vi.fn(),
}));

vi.mock(import("@/actions/simonBot"), () => ({
  forgetMe: vi.fn(),
  getNotesOnMe: vi.fn(),
}));

const username = "brave-otter" as Username;

afterEach(resetPreferences);

describe("runCommand", () => {
  it("aligns the help after each usage", () => {
    expect(runCommand("/help")).toEqual({
      status: "ok",
      output: [
        "/help                       List the commands",
        "/style panes|ledger|manual  Switch the style",
        "/theme system|light|dark    Switch the theme",
        "/whoami                     Show what simon-bot knows about you",
        "/forget                     Make simon-bot forget you",
        "/plays <artist>             Count Simon's plays of an artist",
        "/shuffle                    Pick a random track from Simon's history",
      ],
    });
  });

  it("shows the usage for an option it doesn't take", () => {
    expect(runCommand("/theme blue")).toEqual({
      status: "error",
      error: "Usage: /theme system|light|dark",
    });
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });

  it.each([
    [["likes jazz"], ["simon-bot remembers:", "- likes jazz"]],
    [[], ["simon-bot doesn't remember anything about you yet."]],
  ])("shows who you are and the notes %j", async (notes, lines) => {
    vi.mocked(getNotesOnMe).mockResolvedValue({
      status: "ok",
      data: { username, notes },
    });

    await expect(runCommand("/whoami")).resolves.toEqual({
      status: "ok",
      output: ["You are brave-otter.", ...lines],
    });
  });

  it.each([
    [2, "simon-bot forgot 2 notes about you."],
    [1, "simon-bot forgot 1 note about you."],
    [0, "simon-bot had nothing to forget about you."],
  ])("says how many notes it forgot, %i", async (forgotten, line) => {
    vi.mocked(forgetMe).mockResolvedValue({
      status: "ok",
      data: { forgotten },
    });

    await expect(runCommand("/forget")).resolves.toEqual({
      status: "ok",
      output: [line],
    });
  });

  it.each([
    ["/whoami", getNotesOnMe],
    ["/forget", forgetMe],
    ["/plays Radiohead", getArtistPlays],
    ["/shuffle", getRandomTrack],
  ])("passes on the error from %s", async (text, action) => {
    const error = { status: "error", error: "Failed" } as const;
    vi.mocked(action).mockResolvedValue(error);

    await expect(runCommand(text)).resolves.toEqual(error);
  });

  it("turns a server command that can't be reached into an error", async () => {
    vi.mocked(forgetMe).mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(runCommand("/forget")).resolves.toEqual({
      status: "error",
      error: "Couldn't run /forget. Try again.",
    });
  });

  it.each([
    [1, "Simon has played Radiohead 1 time."],
    [1234, "Simon has played Radiohead 1,234 times."],
  ])("counts %i plays of an artist", async (plays, line) => {
    vi.mocked(getArtistPlays).mockResolvedValue({
      status: "ok",
      data: { name: "Radiohead", plays },
    });

    await expect(runCommand("/Plays the Radiohead")).resolves.toEqual({
      status: "ok",
      output: [line],
    });
    expect(getArtistPlays).toHaveBeenCalledExactlyOnceWith("the Radiohead");
  });

  it("says when Last.fm doesn't know the artist", async () => {
    vi.mocked(getArtistPlays).mockResolvedValue({ status: "ok", data: null });

    await expect(runCommand("/plays Nobody")).resolves.toEqual({
      status: "error",
      error: "Last.fm doesn't know Nobody.",
    });
  });

  it("shows the usage for plays without an artist", async () => {
    await expect(runCommand("/plays")).resolves.toEqual({
      status: "error",
      error: "Usage: /plays <artist>",
    });
    expect(getArtistPlays).not.toHaveBeenCalled();
  });

  it("shows a random track", async () => {
    vi.mocked(getRandomTrack).mockResolvedValue({
      status: "ok",
      data: { name: "Idioteque", artist: "Radiohead", played: "Mar 3, 2014" },
    });

    await expect(runCommand("/shuffle")).resolves.toEqual({
      status: "ok",
      output: ["Idioteque by Radiohead, played Mar 3, 2014."],
    });
  });
});
