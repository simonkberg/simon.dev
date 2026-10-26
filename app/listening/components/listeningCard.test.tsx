import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  type BucketTopArtist,
  getScrobbles,
  getTopAlbums,
  getTopArtistByBucket,
  getTopArtists,
  type ScrobbleCount,
} from "@/actions/lastfm";
import { config } from "@/config";
import { inlineCover } from "@/lib/covers";
import { shareCard } from "@/lib/shareCard";
import { topAlbum } from "@/mocks/lastfm";

import { listeningCard } from "./listeningCard";

vi.mock(import("@/lib/shareCard"), async (importOriginal) => ({
  ...(await importOriginal()),
  shareCard: vi.fn(),
}));

const names = ["Smog", "Low", "Stars", "Hop Along", "Frog"];
const scrobbles: ScrobbleCount[] = names.map((_, index) => ({
  label: String(2022 + index),
  count: 100 * (index + 1),
  current: index === names.length - 1,
}));
// Frog is played least, so its lane is the one left out.
const buckets: BucketTopArtist[] = names.map((name, index) => ({
  label: String(2022 + index),
  artist: { name, playcount: name === "Frog" ? 1 : 50 - index },
}));

vi.mock(import("@/lib/covers"), () => ({
  inlineCover: vi.fn((src: string) => Promise.resolve(`data:${src}`)),
}));

const cover = (name: string) => `${config.lastfmCoverCdn}${name}.jpg`;
const albums = [
  topAlbum("Knock Knock", "Bill Callahan", 1, cover("knock")),
  topAlbum("Pale", "Mimi", 2, cover("pale")),
  topAlbum("Coverless", "Torquil", 3),
  topAlbum("Fourth", "Fourth", 4, cover("fourth")),
  topAlbum("Fifth", "Fifth", 5, cover("fifth")),
];

vi.mock(import("@/actions/lastfm"), () => ({
  getTopAlbums: vi.fn(() => Promise.resolve({ status: "ok" as const, albums })),
  getScrobbles: vi.fn(() =>
    Promise.resolve({ status: "ok" as const, scrobbles }),
  ),
  getTopArtistByBucket: vi.fn(() =>
    Promise.resolve({ status: "ok" as const, buckets }),
  ),
  getTopArtists: vi.fn(() =>
    Promise.resolve({
      status: "ok" as const,
      artists: [{ name: "Smog", playcount: 1234, rank: 1 }],
    }),
  ),
}));

const renderCard = async () => {
  await listeningCard("12month");
  const [[, body] = []] = vi.mocked(shareCard).mock.calls;
  await act(async () => render(body));
};

const error = { status: "error", error: "Failed" } as const;

describe("listeningCard", () => {
  it("shows the period's scrobbles, top artist and most played lanes", async () => {
    await renderCard();

    expect(getScrobbles).toHaveBeenCalledWith("12month");
    expect(shareCard).toHaveBeenCalledWith(
      { window: "listening" },
      expect.anything(),
    );
    expect(screen.getByText("(1 year · per month)")).toBeInTheDocument();
    expect(screen.getByText("1,500")).toBeInTheDocument();
    expect(document.body).toHaveTextContent("top artistSmog1,234");
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("250 avg")).toBeInTheDocument();
    expect(
      screen
        .getAllByText(/^(Smog|Low|Stars|Hop Along|Frog)$/)
        .map((lane) => lane.textContent),
    ).toEqual(["Smog", "Smog", "Low", "Stars", "Hop Along"]);
  });

  it("shows the top album and the covers of the top four", async () => {
    await renderCard();

    expect(getTopAlbums).toHaveBeenCalledWith("12month");
    expect(vi.mocked(inlineCover).mock.calls).toEqual([
      [cover("knock"), 0],
      [cover("pale"), 1],
      [cover("fourth"), 3],
    ]);
    expect(screen.getByText("top album · 39 plays")).toBeInTheDocument();
    expect(screen.getByText("Knock Knock")).toBeInTheDocument();
    expect(
      screen
        .getAllByText(/^[1-4]$/)
        .map((rank) => rank.parentElement?.style.backgroundImage),
    ).toEqual([
      `url("data:${cover("knock")}")`,
      `url("data:${cover("pale")}")`,
      "",
      `url("data:${cover("fourth")}")`,
    ]);
  });

  it("cuts a top artist's name that would run into the covers", async () => {
    vi.mocked(getTopArtists).mockResolvedValue({
      status: "ok",
      artists: [
        { name: "The Magnetic Fields and Friends", playcount: 13041, rank: 1 },
      ],
    });

    await renderCard();

    expect(screen.getByText("The Magnetic Fiel…")).toBeInTheDocument();
  });

  it("leaves out the covers when the albums fail", async () => {
    vi.mocked(getTopAlbums).mockResolvedValue(error);

    await renderCard();

    expect(screen.queryByText(/^top album/)).not.toBeInTheDocument();
  });

  it("leaves out the lanes when the artists fail", async () => {
    vi.mocked(getTopArtistByBucket).mockResolvedValue(error);

    await renderCard();

    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.queryByText("Low")).not.toBeInTheDocument();
  });

  it("says the scrobbles are unavailable when nothing loads", async () => {
    vi.mocked(getScrobbles).mockResolvedValue(error);
    vi.mocked(getTopArtists).mockResolvedValue(error);

    await renderCard();

    expect(
      screen.getByText("Scrobbles are temporarily unavailable :("),
    ).toBeInTheDocument();
    expect(screen.queryByText("top artist")).not.toBeInTheDocument();
  });
});
