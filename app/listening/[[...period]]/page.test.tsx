import { act, render, screen, waitFor } from "@testing-library/react";
import { notFound } from "next/navigation";
import { describe, expect, it, vi } from "vitest";

import {
  getTopAlbums,
  type GetTopAlbumsResult,
  getTopArtists,
  type GetTopArtistsResult,
  getTopTracks,
  type GetTopTracksResult,
} from "@/actions/lastfm";
import { periods } from "@/lib/lastfm";

import ListeningPage, { generateMetadata, generateStaticParams } from "./page";

vi.mock("server-only", () => ({}));

vi.mock(import("next/navigation"), () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

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

const searchParams = Promise.resolve({});

describe("generateMetadata", () => {
  it("should return correct metadata for default period", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ period: undefined }),
      searchParams,
    });

    expect(metadata).toEqual({
      title: "Listening - all time",
      description: "My all time listening statistics from Last.fm",
    });
  });

  it("should return correct metadata for 7day period", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ period: ["7day"] }),
      searchParams,
    });

    expect(metadata).toEqual({
      title: "Listening - 7 days",
      description: "My 7 days listening statistics from Last.fm",
    });
  });

  it("should call notFound for invalid period", async () => {
    await expect(
      generateMetadata({
        params: Promise.resolve({ period: ["invalid"] }),
        searchParams,
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalled();
  });

  it("should call notFound for extra path segments", async () => {
    await expect(
      generateMetadata({
        params: Promise.resolve({ period: ["7day", "extra"] }),
        searchParams,
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalled();
  });
});

describe("generateStaticParams", () => {
  it("should return params for all periods", () => {
    const params = generateStaticParams();

    expect(params).toHaveLength(periods.length);
  });

  it("should return undefined for overall period", () => {
    const params = generateStaticParams();
    const overallParam = params.find((p) => p.period === undefined);

    expect(overallParam).toBeDefined();
  });

  it("should return array with period for non-overall periods", () => {
    const params = generateStaticParams();
    const sevenDayParam = params.find(
      (p) => Array.isArray(p.period) && p.period[0] === "7day",
    );

    expect(sevenDayParam).toEqual({ period: ["7day"] });
  });
});

describe("ListeningPage", () => {
  it("should render page with period content", async () => {
    await act(async () =>
      render(
        <ListeningPage
          params={Promise.resolve({ period: ["7day"] })}
          searchParams={searchParams}
        />,
      ),
    );

    expect(
      screen.getByText(/My 7 days listening statistics from/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Last.fm" })).toHaveAttribute(
      "href",
      "https://www.last.fm/user/magijo",
    );
  });

  it("should render period selector with current period", async () => {
    await act(async () =>
      render(
        <ListeningPage
          params={Promise.resolve({ period: ["7day"] })}
          searchParams={searchParams}
        />,
      ),
    );

    // Current period should not be a link
    expect(screen.getByText("7 days")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "7 days" }),
    ).not.toBeInTheDocument();

    // Other periods should be links
    expect(screen.getByRole("link", { name: "all time" })).toBeInTheDocument();
  });

  it("should render table sections with headings", async () => {
    await act(async () =>
      render(
        <ListeningPage
          params={Promise.resolve({ period: undefined })}
          searchParams={searchParams}
        />,
      ),
    );

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

    await act(async () =>
      render(
        <ListeningPage
          params={Promise.resolve({ period: undefined })}
          searchParams={searchParams}
        />,
      ),
    );

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
