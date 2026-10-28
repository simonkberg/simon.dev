import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getDayPlays, type GetDayPlaysResult } from "@/actions/listening";

import { toDay } from "../../../toDay";
import TimeTravelPage, { generateMetadata, generateStaticParams } from "./page";

vi.mock(import("../../../toDay"), () => ({
  toDay: vi.fn(() => Promise.resolve("2012-10-14" as const)),
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

const params = Promise.resolve({ year: "2012", month: "10", day: "14" });
const searchParams = Promise.resolve({});

describe("generateStaticParams", () => {
  it("prerenders the first day scrobbled, in its month", () => {
    expect(generateStaticParams()).toEqual([{ day: "18" }]);
  });
});

describe("generateMetadata", () => {
  it("names the day", async () => {
    expect(await generateMetadata({ params, searchParams })).toMatchObject({
      title: "Listening - Sun, Oct 14, 2012",
    });
  });
});

describe("TimeTravelPage", () => {
  it("shows what played", async () => {
    await act(async () =>
      render(await TimeTravelPage({ params, searchParams })),
    );

    expect(toDay).toHaveBeenCalledWith({
      year: "2012",
      month: "10",
      day: "14",
    });
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
      render(await TimeTravelPage({ params, searchParams })),
    );

    expect(screen.getByText("(Sun, Oct 14, 2012)")).toBeInTheDocument();
    expect(screen.getByText(/temporarily unavailable/)).toBeInTheDocument();
  });
});
