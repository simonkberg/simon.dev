import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  type GetRecentTracksResult,
  getRecentTracks,
  type GetScrobblesResult,
  getScrobbles,
} from "@/actions/listening";
import type { RecentTrack } from "@/lib/scrobbles";
import { shareCard } from "@/lib/shareCard";

import openGraphImage from "./opengraph-image";

vi.mock(import("@/lib/shareCard"), async (importOriginal) => ({
  ...(await importOriginal()),
  shareCard: vi.fn(),
}));

const track: RecentTrack = {
  name: "Ichabod Crane",
  artist: "Frog",
  album: "Grog",
  playedAt: new Date("2026-10-26T18:00:00Z"),
  nowPlaying: false,
  loved: false,
};

vi.mock(import("@/actions/listening"), () => ({
  getRecentTracks: vi.fn(() =>
    Promise.resolve<GetRecentTracksResult>({ status: "ok", tracks: [track] }),
  ),
  getScrobbles: vi.fn(() =>
    Promise.resolve<GetScrobblesResult>({
      status: "ok",
      scrobbles: [
        { label: "2025", count: 16_686, current: false },
        { label: "2026", count: 29_948, current: true },
      ],
    }),
  ),
}));

// The card's body, rendered as HTML so it can be queried.
const renderCard = async () => {
  await openGraphImage();
  const [[, body] = []] = vi.mocked(shareCard).mock.calls;
  await act(async () => render(body));
};

describe("opengraph-image", () => {
  it("shows the last played track and every year's scrobbles", async () => {
    await renderCard();

    expect(getScrobbles).toHaveBeenCalledWith("overall");
    expect(screen.getByText("LAST PLAYED")).toBeInTheDocument();
    expect(screen.getByText("Ichabod Crane –")).toBeInTheDocument();
    expect(screen.getByText("Frog")).toBeInTheDocument();
    expect(screen.getByText("46,634 scrobbles since 2007")).toBeInTheDocument();
  });

  it("says so when the track is playing", async () => {
    vi.mocked(getRecentTracks).mockResolvedValue({
      status: "ok",
      tracks: [{ ...track, nowPlaying: true }],
    });

    await renderCard();

    expect(screen.getByText("NOW PLAYING")).toBeInTheDocument();
  });

  it("leaves out what fails to load", async () => {
    vi.mocked(getRecentTracks).mockResolvedValue({
      status: "error",
      error: "Failed",
    });
    vi.mocked(getScrobbles).mockResolvedValue({
      status: "error",
      error: "Failed",
    });

    await renderCard();

    expect(screen.getByText("simon kjellberg")).toBeInTheDocument();
    expect(screen.queryByText("LAST PLAYED")).not.toBeInTheDocument();
    expect(screen.queryByText(/scrobbles since/)).not.toBeInTheDocument();
  });
});
