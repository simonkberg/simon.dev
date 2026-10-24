import { act, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  getScrobbles,
  type GetScrobblesResult,
  getTopAlbums,
  type GetTopAlbumsResult,
  getTopArtists,
  type GetTopArtistsResult,
  getTopTracks,
  type GetTopTracksResult,
} from "@/actions/lastfm";
import { periods } from "@/lib/lastfm";

import ListeningPage, { generateMetadata, generateStaticParams } from "./page";

vi.mock(import("next/navigation"), () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock(import("@/actions/lastfm"), () => ({
  getScrobbles: vi.fn(() =>
    Promise.resolve<GetScrobblesResult>({ status: "ok", scrobbles: [] }),
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

const searchParams = Promise.resolve({});

const metadataFor = (period?: string[]) =>
  generateMetadata({ params: Promise.resolve({ period }), searchParams });

const renderPage = (period?: string[]) =>
  act(async () =>
    render(
      <ListeningPage
        params={Promise.resolve({ period })}
        searchParams={searchParams}
      />,
    ),
  );

describe("generateMetadata", () => {
  it.each([
    [undefined, "all time"],
    [["7day"], "7 days"],
  ])("should return the metadata for %j", async (period, label) => {
    expect(await metadataFor(period)).toEqual({
      title: `Listening - ${label}`,
      description: `My ${label} listening statistics from Last.fm`,
    });
  });

  it.each([[["invalid"]], [["7day", "extra"]]])(
    "should call notFound for %j",
    async (period) => {
      await expect(metadataFor(period)).rejects.toThrow("NEXT_NOT_FOUND");
    },
  );
});

describe("generateStaticParams", () => {
  it("should return params for all periods, overall as the base path", () => {
    expect(generateStaticParams()).toEqual(
      periods.map((period) => ({
        period: period === "overall" ? [] : [period],
      })),
    );
  });
});

describe("ListeningPage", () => {
  it("should render page with period content", async () => {
    await renderPage(["7day"]);

    expect(
      screen.getByText(/My 7 days listening statistics from/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Last.fm" })).toHaveAttribute(
      "href",
      "https://www.last.fm/user/magijo",
    );
  });

  it("should render period selector with current period", async () => {
    await renderPage(["7day"]);

    const selector = screen.getByRole("list", { name: "Period" });
    expect(within(selector).getByText("7 days")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("should render the scrobbles per bucket of the period", async () => {
    vi.mocked(getScrobbles).mockResolvedValue({
      status: "ok",
      scrobbles: [
        {
          label: "2026",
          count: 42,
          topArtist: { name: "Smog", playcount: 7 },
          current: true,
        },
      ],
    });

    await renderPage();

    expect(getScrobbles).toHaveBeenCalledWith("overall");
    expect(
      screen.getByRole("heading", { name: "Scrobbles (per year)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2026: 42 so far")).toBeInTheDocument();
    expect(screen.getByText("Smog: 7 plays in 2026")).toBeInTheDocument();
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
    expect(screen.getAllByRole("table")).toHaveLength(3);
  });
});
