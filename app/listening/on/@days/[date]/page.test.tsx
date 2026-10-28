import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  getDailyScrobbles,
  type GetScrobblesResult,
} from "@/actions/listening";

import MonthDaysPage, { generateStaticParams } from "./page";

vi.mock(import("next/navigation"), () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock(import("@/lib/today"), () => ({
  getToday: vi.fn(() => Promise.resolve("2026-10-28" as const)),
}));

vi.mock(import("@/actions/listening"), () => ({
  getDailyScrobbles: vi.fn(() =>
    Promise.resolve<GetScrobblesResult>({
      status: "ok",
      scrobbles: [{ label: "Oct 1", count: 46, current: false }],
    }),
  ),
}));

const props = {
  params: Promise.resolve({ date: "2012-10-01" }),
  searchParams: Promise.resolve({}),
};

describe("generateStaticParams", () => {
  it("prerenders the first day scrobbled, as the day's page does", () => {
    expect(generateStaticParams()).toEqual([{ date: "2007-12-18" }]);
  });
});

describe("MonthDaysPage", () => {
  it("shows the day's month", async () => {
    render(await MonthDaysPage(props));

    expect(getDailyScrobbles).toHaveBeenCalledWith("2012-10");
    expect(
      screen.getByRole("link", { name: "Oct 1: 46 plays" }),
    ).toHaveAttribute("aria-current", "date");
  });

  it("says the days failed to load", async () => {
    vi.mocked(getDailyScrobbles).mockResolvedValue({
      status: "error",
      error: "Failed",
    });

    render(await MonthDaysPage(props));

    expect(
      screen.getByText("This month’s days are temporarily unavailable :("),
    ).toBeInTheDocument();
  });
});
