import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getDayPlays, type GetDayPlaysResult } from "@/actions/listening";

import TimeTravelPage, { generateMetadata, generateStaticParams } from "./page";

vi.mock(import("next/navigation"), () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock(import("@/lib/today"), () => ({
  getToday: vi.fn(() => Promise.resolve("2026-10-28" as const)),
}));

vi.mock(import("@/actions/listening"), () => ({
  getDayPlays: vi.fn(() =>
    Promise.resolve<GetDayPlaysResult>({
      status: "ok",
      plays: [
        { name: "Old Fools", artist: "The Magnetic Fields", time: "16:27" },
      ],
    }),
  ),
}));

const params = (date: string) =>
  Promise.resolve({ month: date.slice(0, 7), day: date.slice(8) });
const searchParams = Promise.resolve({});

describe("generateStaticParams", () => {
  it("prerenders the first day scrobbled, in its month", () => {
    expect(generateStaticParams()).toEqual([{ day: "18" }]);
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
  it("shows what played", async () => {
    await act(async () =>
      render(
        await TimeTravelPage({ params: params("2012-10-14"), searchParams }),
      ),
    );

    expect(getDayPlays).toHaveBeenCalledWith("2012-10-14");
    expect(
      screen.getByText("(Sun, Oct 14, 2012 · 1 play)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Old Fools")).toBeInTheDocument();
  });

  it("says the plays failed to load", async () => {
    vi.mocked(getDayPlays).mockResolvedValue({
      status: "error",
      error: "Failed",
    });

    await act(async () =>
      render(
        await TimeTravelPage({ params: params("2012-10-14"), searchParams }),
      ),
    );

    expect(screen.getByText("(Sun, Oct 14, 2012)")).toBeInTheDocument();
    expect(
      screen.getByText("The day’s plays are temporarily unavailable :("),
    ).toBeInTheDocument();
  });
});
