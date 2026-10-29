import { beforeEach, describe, expect, it, vi } from "vitest";

import { MIGRATIONS } from "@/lib/migrations";
import { query } from "@/lib/turso";
import { sqliteBeforeEach } from "@/mocks/sqlite";

import { dayFacts } from "./diaryFacts";

vi.mock(import("@/lib/turso"), async () =>
  (await import("@/mocks/sqlite")).mockTurso(),
);

sqliteBeforeEach(query, MIGRATIONS);

const play = (at: string, artist: string, track: string) =>
  query("INSERT INTO scrobbles VALUES (?, ?, ?, '')", [
    new Date(at).getTime(),
    artist,
    track,
  ]);

describe("dayFacts", () => {
  beforeEach(async () => {
    await play("2024-01-01T12:00:00Z", "Radiohead", "Idioteque");
    // 23:00 in Stockholm on nine days before, summer time and after.
    for (let day = 16; day <= 24; day++) {
      await play(`2026-10-${day}T21:00:00Z`, "Smog", "Held");
    }
    // October 27th in Stockholm runs from 23:00 UTC the day before.
    await play("2026-10-27T01:30:00Z", "Brand New", "First");
    await play("2026-10-27T10:00:00Z", "Radiohead", "Airbag");
    await play("2026-10-27T10:04:00Z", "Radiohead", "Airbag");
    await play("2026-10-27T10:08:00Z", "Radiohead", "Airbag");
    await play("2026-10-27T22:00:00Z", "Smog", "Held");
    await play("2026-10-27T23:00:00Z", "Smog", "Held");
  });

  it("should tell what stood out in a Stockholm day", async () => {
    await expect(dayFacts("2026-10-27")).resolves.toEqual({
      day: "Tue, Oct 27, 2026",
      plays: 5,
      typicalPlays: 0,
      topArtists: [
        { artist: "Radiohead", plays: 3 },
        { artist: "Brand New", plays: 1 },
        { artist: "Smog", plays: 1 },
      ],
      repeats: [{ artist: "Radiohead", track: "Airbag", plays: 3 }],
      firstTimeArtists: [{ artist: "Brand New", plays: 1 }],
      returningArtists: [
        {
          artist: "Radiohead",
          plays: 3,
          lastPlayedBefore: new Date("2024-01-01T12:00:00Z"),
        },
      ],
      longestRun: {
        from: new Date("2026-10-27T10:00:00Z"),
        to: new Date("2026-10-27T10:08:00Z"),
        plays: 3,
      },
      hours: [
        { hour: "02", plays: 1, typical: 0 },
        { hour: "11", plays: 3, typical: 0 },
        { hour: "23", plays: 1, typical: 0.1 },
      ],
    });
  });

  it("should take the median day over the 90 before", async () => {
    for (let day = 0; day < 45; day++) {
      const at = Date.UTC(2026, 8, 1 + day, 12);
      await play(new Date(at).toISOString(), "Smog", "Held");
      await play(new Date(at + 60_000).toISOString(), "Smog", "Held");
    }

    await expect(dayFacts("2026-10-27")).resolves.toMatchObject({
      typicalPlays: 2,
    });
  });

  it("should find no run on a day of single plays", async () => {
    await expect(dayFacts("2026-10-24")).resolves.not.toHaveProperty(
      "longestRun",
    );
  });
});
