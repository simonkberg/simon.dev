import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  getDayPlays,
  type GetDayPlaysResult,
  getDailyScrobbles,
  getScrobbleMonths,
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

import TimeTravelPage, { generateMetadata, generateStaticParams } from "./page";

vi.mock(import("next/navigation"), () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  useRouter: vi.fn(),
}));

const scrobbles = (count: number, label: string): Promise<GetScrobblesResult> =>
  Promise.resolve({
    status: "ok",
    scrobbles: [{ label, count, current: false }],
  });

vi.mock(import("@/actions/listening"), () => ({
  getToday: vi.fn(() => Promise.resolve("2026-10-28" as const)),
  getScrobbleMonths: vi.fn(() => scrobbles(811, "Jan 2007")),
  getTopArtistByBucket: vi.fn(() =>
    Promise.resolve<GetTopArtistByBucketResult>({ status: "ok", buckets: [] }),
  ),
  getDailyScrobbles: vi.fn(() => scrobbles(46, "Jan 1")),
  getDayPlays: vi.fn(() =>
    Promise.resolve<GetDayPlaysResult>({
      status: "ok",
      plays: [
        { name: "Old Fools", artist: "The Magnetic Fields", time: "16:27" },
      ],
    }),
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

const params = (date: string) => Promise.resolve({ date });
const searchParams = Promise.resolve({});

describe("generateStaticParams", () => {
  it("prerenders the first day scrobbled", () => {
    expect(generateStaticParams()).toEqual([{ date: "2007-12-18" }]);
  });
});

describe("generateMetadata", () => {
  it("names the day", async () => {
    expect(
      await generateMetadata({ params: params("2012-10-14"), searchParams }),
    ).toMatchObject({ title: "Listening - Sun, Oct 14, 2012" });
  });
});

describe("TimeTravelPage", () => {
  it("shows the day on the tape, what played and its month's tops", async () => {
    await act(async () =>
      render(
        await TimeTravelPage({ params: params("2012-10-14"), searchParams }),
      ),
    );

    expect(screen.getByText("time travel")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(getScrobbleMonths).toHaveBeenCalled();
    expect(getTopArtistByBucket).toHaveBeenCalledWith("overall");
    expect(getDailyScrobbles).toHaveBeenCalledWith("2012-10");
    expect(getDayPlays).toHaveBeenCalledWith("2012-10-14");
    for (const top of [getTopTracks, getTopArtists, getTopAlbums]) {
      expect(top).toHaveBeenCalledWith("2012-10");
    }
    expect(screen.getByRole("status")).toHaveTextContent("Sun, Oct 14, 2012");
    expect(screen.getByText("Old Fools")).toBeInTheDocument();
    expect(screen.getAllByText("(Oct 2012)")).toHaveLength(3);
  });

  it("says what failed to load", async () => {
    const error = { status: "error", error: "Failed" } as const;
    vi.mocked(getScrobbleMonths).mockResolvedValue(error);
    vi.mocked(getTopArtistByBucket).mockResolvedValue(error);
    vi.mocked(getDailyScrobbles).mockResolvedValue(error);
    vi.mocked(getDayPlays).mockResolvedValue(error);

    await act(async () =>
      render(
        await TimeTravelPage({ params: params("2012-10-14"), searchParams }),
      ),
    );

    expect(
      screen.getByText("Time travel is temporarily unavailable :("),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The day’s plays are temporarily unavailable :("),
    ).toBeInTheDocument();
  });
});
