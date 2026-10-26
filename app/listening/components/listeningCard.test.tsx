import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  type BucketTopArtist,
  getScrobbles,
  getTopArtistByBucket,
  getTopArtists,
  type ScrobbleCount,
} from "@/actions/lastfm";
import { shareCard } from "@/lib/shareCard";

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

vi.mock(import("@/actions/lastfm"), () => ({
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
