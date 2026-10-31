import { describe, expect, it } from "vitest";

import type { PlayedYear } from "@/actions/listening";

import { topTrackPlays } from "./onThisDay";

describe("topTrackPlays", () => {
  const year = (count: number, plays: number): PlayedYear => ({
    year: "2025",
    day: "2025-10-31",
    count,
    top: { artist: "Black Country, New Road", track: "Snow Globes", plays },
  });

  it.each([
    [35, 2, "(2 plays)"],
    [3, 3, undefined],
  ])("of %i plays, %i by the track gives %s", (count, plays, expected) => {
    expect(topTrackPlays(year(count, plays))).toBe(expected);
  });
});
