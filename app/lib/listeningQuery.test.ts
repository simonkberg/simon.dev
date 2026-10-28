import { beforeEach, describe, expect, it, vi } from "vitest";

import { MIGRATIONS } from "@/lib/migrations";
import { query } from "@/lib/turso";
import { sqliteBeforeEach } from "@/mocks/sqlite";

import { playCounts, plays, top } from "./listeningQuery";

vi.mock(import("@/lib/turso"), async () =>
  (await import("@/mocks/sqlite")).mockTurso(),
);

sqliteBeforeEach(query, MIGRATIONS);

const play = (at: string, artist: string, track: string, album = "") =>
  query("INSERT INTO scrobbles VALUES (?, ?, ?, ?)", [
    new Date(at).getTime(),
    artist,
    track,
    album,
  ]);

describe("plays", () => {
  beforeEach(async () => {
    // 23:30 on the 31st in Stockholm.
    await play("2015-12-31T22:30:00Z", "Radiohead", "Idioteque", "Kid A");
    // 00:30 on the 1st in Stockholm.
    await play("2015-12-31T23:30:00Z", "Radiohead", "Airbag", "OK Computer");
    await play("2016-01-01T12:00:00Z", "Smog", "Held", "Knock Knock");
    await query("INSERT INTO loved VALUES ('Radiohead', 'Airbag', 1)");
  });

  it("should count and list matching plays from a time", async () => {
    await expect(
      plays(
        { from: new Date("2015-12-31T23:00:00Z"), artist: "radio" },
        "oldest",
        5,
      ),
    ).resolves.toEqual({
      total: 1,
      plays: [
        {
          name: "Airbag",
          artist: "Radiohead",
          album: "OK Computer",
          playedAt: new Date("2015-12-31T23:30:00Z"),
          loved: true,
        },
      ],
    });
  });

  it("should give the newest first, and count past the limit", async () => {
    const { total, plays: found } = await plays(
      { to: new Date("2016-01-01T23:00:00Z") },
      "newest",
      1,
    );

    expect(total).toBe(3);
    expect(found.map(({ name }) => name)).toEqual(["Held"]);
  });

  it.each([
    { loved: true, names: ["Airbag"] },
    { loved: false, names: ["Held", "Idioteque"] },
  ])("should keep plays whose loved is $loved", async ({ loved, names }) => {
    const { plays: found } = await plays({ loved }, "newest", 5);

    expect(found.map(({ name }) => name)).toEqual(names);
  });

  it("should match LIKE's wildcards as text", async () => {
    await play("2016-01-02T12:00:00Z", "Tool", "100% Pure", "");
    await play("2016-01-02T13:00:00Z", "Tool", "1000 Pure", "");

    const { plays: found } = await plays({ track: "100%" }, "newest", 5);

    expect(found.map(({ name }) => name)).toEqual(["100% Pure"]);
  });
});

describe("top", () => {
  beforeEach(async () => {
    await play("2016-01-01T10:00:00Z", "Smog", "Held", "Knock Knock");
    await play("2016-01-02T10:00:00Z", "Smog", "Held", "Knock Knock");
    await play("2016-01-03T10:00:00Z", "Smog", "Cold Blooded Old Times", "");
    await play("2016-01-04T10:00:00Z", "Bill Callahan", "Drover", "Apocalypse");
  });

  it("should rank tracks with their first and last plays", async () => {
    await expect(top({}, "track", 2)).resolves.toEqual([
      {
        artist: "Smog",
        track: "Held",
        plays: 2,
        firstPlayed: new Date("2016-01-01T10:00:00Z"),
        lastPlayed: new Date("2016-01-02T10:00:00Z"),
      },
      {
        artist: "Bill Callahan",
        track: "Drover",
        plays: 1,
        firstPlayed: new Date("2016-01-04T10:00:00Z"),
        lastPlayed: new Date("2016-01-04T10:00:00Z"),
      },
    ]);
  });

  it("should leave plays without an album out of albums", async () => {
    const albums = await top({ artist: "Smog" }, "album", 5);

    expect(albums).toEqual([
      expect.objectContaining({ album: "Knock Knock", plays: 2 }),
    ]);
  });
});

describe("playCounts", () => {
  beforeEach(async () => {
    // Summer time starts at 01:00 UTC on 2026-03-29 and ends at 01:00 UTC on 2026-10-25.
    await play("2026-03-29T00:30:00Z", "A", "T");
    await play("2026-03-29T01:30:00Z", "A", "T");
    await play("2026-10-25T00:30:00Z", "A", "T");
    await play("2026-10-25T01:30:00Z", "B", "T");
  });

  it("should count in all", async () => {
    await expect(
      playCounts({ artist: "A" }, undefined, "time", 5),
    ).resolves.toEqual({ total: 3 });
  });

  it("should count per Stockholm hour across summer time", async () => {
    await expect(playCounts({}, "hour", "time", 5)).resolves.toEqual({
      total: 4,
      counts: [
        { period: "01", plays: 1 },
        { period: "02", plays: 2 },
        { period: "03", plays: 1 },
      ],
    });
  });

  it("should name weekdays, Monday first", async () => {
    await play("2026-03-30T12:00:00Z", "A", "T");

    const { counts } = await playCounts({}, "weekday", "time", 5);

    expect(counts).toEqual([
      { period: "Monday", plays: 1 },
      { period: "Sunday", plays: 4 },
    ]);
  });

  it("should start weeks on Monday", async () => {
    const { counts } = await playCounts({}, "week", "time", 5);

    expect(counts).toEqual([
      { period: "2026-03-23", plays: 2 },
      { period: "2026-10-19", plays: 2 },
    ]);
  });

  it("should give the busiest first, and say when more were left out", async () => {
    await expect(playCounts({}, "month", "plays", 1)).resolves.toEqual({
      total: 4,
      counts: [{ period: "2026-03", plays: 2 }],
      truncated: true,
    });
  });
});
