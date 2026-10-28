import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  getTopAlbums,
  type GetTopAlbumsResult,
  getTopArtists,
  type GetTopArtistsResult,
  getTopTracks,
  type GetTopTracksResult,
} from "@/actions/listening";

import { toMonth } from "../../toDay";
import MonthLayout, { generateStaticParams } from "./layout";

vi.mock(import("../../toDay"), () => ({
  toMonth: vi.fn(() => Promise.resolve("2012-10" as const)),
}));

vi.mock(import("@/actions/listening"), () => ({
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

describe("generateStaticParams", () => {
  it("prerenders the first month scrobbled", () => {
    expect(generateStaticParams()).toEqual([{ year: "2007", month: "12" }]);
  });
});

describe("MonthLayout", () => {
  it("shows the month's tops under the day", async () => {
    await act(async () =>
      render(
        await MonthLayout({
          params: Promise.resolve({ year: "2012", month: "10" }),
          children: <p>The day</p>,
        }),
      ),
    );

    expect(toMonth).toHaveBeenCalledWith({ year: "2012", month: "10" });
    for (const top of [getTopTracks, getTopArtists, getTopAlbums]) {
      expect(top).toHaveBeenCalledWith("2012-10");
    }
    expect(screen.getAllByText("(Oct 2012)")).toHaveLength(3);
    expect(screen.getByText("The day")).toBeInTheDocument();
  });
});
