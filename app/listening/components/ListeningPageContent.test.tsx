import { act, render, screen, waitFor } from "@testing-library/react";
import { objectEntries } from "ts-extras";
import { describe, expect, it, vi } from "vitest";

import {
  getTopAlbums,
  type GetTopAlbumsResult,
  getTopArtists,
  type GetTopArtistsResult,
  getTopTracks,
  type GetTopTracksResult,
} from "@/actions/lastfm";
import { periodLabels } from "@/lib/lastfm";

import {
  generateListeningMetadata,
  ListeningPageContent,
} from "./ListeningPageContent";

vi.mock("server-only", () => ({}));

vi.mock(import("@/actions/lastfm"), () => ({
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

describe("generateListeningMetadata", () => {
  it.each(objectEntries(periodLabels))(
    "should return correct metadata for %s period",
    (period, label) => {
      const metadata = generateListeningMetadata(period);

      expect(metadata).toEqual({
        title: `Listening - ${label}`,
        description: `My ${label} listening statistics from Last.fm`,
      });
    },
  );
});

describe("ListeningPageContent", () => {
  it("should render page with period content", async () => {
    await act(async () => render(<ListeningPageContent period="7day" />));

    expect(
      screen.getByText(/My 7 days listening statistics from/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Last.fm" })).toHaveAttribute(
      "href",
      "https://www.last.fm/user/magijo",
    );
  });

  it("should render period selector with current period", async () => {
    await act(async () => render(<ListeningPageContent period="7day" />));

    // Current period should not be a link
    expect(screen.getByText("7 days")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "7 days" }),
    ).not.toBeInTheDocument();

    // Other periods should be links
    expect(screen.getByRole("link", { name: "all time" })).toBeInTheDocument();
  });

  it("should render table sections with headings", async () => {
    await act(async () => render(<ListeningPageContent period="overall" />));

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

    await act(async () => render(<ListeningPageContent period="overall" />));

    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(
      screen.queryByRole("heading", { name: /Top Tracks/ }),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveTracks({ status: "ok", tracks: [] });
      resolveArtists({ status: "ok", artists: [] });
      resolveAlbums({ status: "ok", albums: [] });
    });

    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    expect(
      screen.getByRole("heading", { name: /Top Tracks/ }),
    ).toBeInTheDocument();
  });
});
