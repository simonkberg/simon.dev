import { act, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  getScrobbles,
  type GetScrobblesResult,
  getTopAlbums,
  type GetTopAlbumsResult,
  getTopArtistByBucket,
  type GetTopArtistByBucketResult,
  getTopArtists,
  type GetTopArtistsResult,
  getTopTracks,
  type GetTopTracksResult,
} from "@/actions/listening";
import { getCommentary } from "@/lib/commentary";
import type { Period } from "@/lib/periods";

import { ListeningPeriod, periodMetadata } from "./ListeningPeriod";

vi.mock(import("@/lib/commentary"), () => ({
  getCommentary: vi.fn(async () => ({
    status: "ok" as const,
    text: "frog ate the week",
  })),
}));
vi.mock(import("@/actions/listening"), () => ({
  getScrobbles: vi.fn(() =>
    Promise.resolve<GetScrobblesResult>({ status: "ok", scrobbles: [] }),
  ),
  getTopArtistByBucket: vi.fn(() =>
    Promise.resolve<GetTopArtistByBucketResult>({ status: "ok", buckets: [] }),
  ),
  getTopTracks: vi.fn(() =>
    Promise.resolve<GetTopTracksResult>({ status: "ok", tracks: [] }),
  ),
  getTopArtists: vi.fn(() =>
    Promise.resolve<GetTopArtistsResult>({ status: "ok", artists: [] }),
  ),
  getTopAlbums: vi.fn(() =>
    Promise.resolve<GetTopAlbumsResult>({ status: "ok", albums: [] }),
  ),
}));

const renderPage = (period: Period = "overall") =>
  act(async () => render(<ListeningPeriod period={period} />));

describe("periodMetadata", () => {
  it("names the period", () => {
    expect(periodMetadata("7day")).toEqual({
      title: "Listening - 7 days",
      description: "My 7 days listening statistics from Last.fm",
    });
  });
});

describe("ListeningPeriod", () => {
  it("should render page with period content", async () => {
    await renderPage("7day");

    expect(
      screen.getByText(/My 7 days listening statistics from/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Last.fm" })).toHaveAttribute(
      "href",
      "https://www.last.fm/user/magijo",
    );
  });

  it("should render the stored take with the page", async () => {
    await renderPage("1month");

    expect(getCommentary).toHaveBeenCalledWith("1month");
    expect(screen.getByText("frog ate the week")).toBeInTheDocument();
  });

  it("should render period selector with current period", async () => {
    await renderPage("7day");

    const selector = screen.getByRole("list", { name: "Period" });
    expect(within(selector).getByText("7 days")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("should render the scrobbles per bucket of the period", async () => {
    vi.mocked(getScrobbles).mockResolvedValue({
      status: "ok",
      scrobbles: [{ label: "2026", count: 42, current: true }],
    });
    vi.mocked(getTopArtistByBucket).mockResolvedValue({
      status: "ok",
      buckets: [{ label: "2026", artist: { name: "Smog", playcount: 7 } }],
    });

    await renderPage();

    expect(getScrobbles).toHaveBeenCalledWith("overall");
    expect(getTopArtistByBucket).toHaveBeenCalledWith("overall");
    expect(
      screen.getByRole("heading", { name: "Scrobbles (per year)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2026: 42 so far")).toBeInTheDocument();
    expect(screen.getByText("Smog: 7 plays in 2026")).toBeInTheDocument();
  });

  it("should keep the scrobbles when the top artists fail", async () => {
    vi.mocked(getScrobbles).mockResolvedValue({
      status: "ok",
      scrobbles: [{ label: "2026", count: 42, current: true }],
    });
    vi.mocked(getTopArtistByBucket).mockResolvedValue({
      status: "error",
      error: "Failed",
    });

    await renderPage();

    expect(screen.getByText("2026: 42 so far")).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Top artists" }),
    ).not.toBeInTheDocument();
  });

  it("should render table sections with headings", async () => {
    await renderPage();

    expect(
      screen.getByRole("heading", { name: /Top Tracks/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Top Artists/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Top Albums/ }),
    ).toBeInTheDocument();
  });

  it("says each list that failed to load is unavailable", async () => {
    const error = { status: "error", error: "Failed" } as const;
    vi.mocked(getTopTracks).mockResolvedValue(error);
    vi.mocked(getTopArtists).mockResolvedValue(error);
    vi.mocked(getTopAlbums).mockResolvedValue(error);
    vi.mocked(getScrobbles).mockResolvedValue(error);

    await renderPage();

    expect(
      screen.getByText("Scrobbles are temporarily unavailable :("),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    for (const noun of ["tracks", "artists", "albums"]) {
      expect(
        screen.getByText(`Top ${noun} are temporarily unavailable :(`),
      ).toBeInTheDocument();
    }
  });

  it("should show loading state while data is fetching", async () => {
    const { promise: tracksPromise, resolve: resolveTracks } =
      Promise.withResolvers<GetTopTracksResult>();
    const { promise: artistsPromise, resolve: resolveArtists } =
      Promise.withResolvers<GetTopArtistsResult>();
    const { promise: albumsPromise, resolve: resolveAlbums } =
      Promise.withResolvers<GetTopAlbumsResult>();

    vi.mocked(getTopTracks).mockReturnValue(tracksPromise);
    vi.mocked(getTopArtists).mockReturnValue(artistsPromise);
    vi.mocked(getTopAlbums).mockReturnValue(albumsPromise);

    await renderPage();

    expect(screen.getAllByRole("status")).toHaveLength(3);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Top Tracks/ }),
    ).toBeInTheDocument();

    await act(async () => {
      resolveTracks({ status: "ok", tracks: [] });
    });

    await waitFor(() => {
      expect(screen.getAllByRole("status")).toHaveLength(2);
    });

    await act(async () => {
      resolveArtists({ status: "ok", artists: [] });
      resolveAlbums({ status: "ok", albums: [] });
    });

    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
    expect(screen.getAllByRole("table")).toHaveLength(2);
  });
});
