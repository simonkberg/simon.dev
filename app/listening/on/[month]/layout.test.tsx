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

import MonthLayout, { generateStaticParams } from "./layout";

vi.mock(import("next/navigation"), () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock(import("@/lib/today"), () => ({
  getToday: vi.fn(() => Promise.resolve("2026-10-28" as const)),
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
    expect(generateStaticParams()).toEqual([{ month: "2007-12" }]);
  });
});

describe("MonthLayout", () => {
  it("shows the month's tops under the day", async () => {
    await act(async () =>
      render(
        await MonthLayout({
          params: Promise.resolve({ month: "2012-10" }),
          children: <p>The day</p>,
        }),
      ),
    );

    for (const top of [getTopTracks, getTopArtists, getTopAlbums]) {
      expect(top).toHaveBeenCalledWith("2012-10");
    }
    expect(screen.getAllByText("(Oct 2012)")).toHaveLength(3);
    expect(screen.getByText("The day")).toBeInTheDocument();
  });

  it("turns away a month time travel doesn't reach", async () => {
    await expect(
      MonthLayout({
        params: Promise.resolve({ month: "2026-11" }),
        children: null,
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
