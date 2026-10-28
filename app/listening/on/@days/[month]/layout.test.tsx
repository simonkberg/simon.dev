import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  getDailyScrobbles,
  type GetScrobblesResult,
} from "@/actions/listening";

import MonthDaysLayout, { generateStaticParams } from "./layout";

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
  params: Promise.resolve({ month: "2012-10" }),
  children: <p>The day</p>,
};

describe("generateStaticParams", () => {
  it("prerenders the first month scrobbled, as the day's layout does", () => {
    expect(generateStaticParams()).toEqual([{ month: "2007-12" }]);
  });
});

describe("MonthDaysLayout", () => {
  it("shows the month's days", async () => {
    render(await MonthDaysLayout(props));

    expect(getDailyScrobbles).toHaveBeenCalledWith("2012-10");
    expect(
      screen.getByRole("link", { name: "Oct 1: 46 plays" }),
    ).toHaveAttribute("href", "/listening/on/2012-10-01");
    expect(screen.getByText("The day")).toBeInTheDocument();
  });

  it("says the days failed to load", async () => {
    vi.mocked(getDailyScrobbles).mockResolvedValue({
      status: "error",
      error: "Failed",
    });

    render(await MonthDaysLayout(props));

    expect(
      screen.getByText("This month’s days are temporarily unavailable :("),
    ).toBeInTheDocument();
  });
});
