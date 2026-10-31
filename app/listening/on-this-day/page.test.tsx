import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getOnThisDay, type GetOnThisDayResult } from "@/actions/listening";
import { storedTake } from "@/lib/commentary";

import OnThisDayPage from "./page";

vi.mock(import("@/actions/listening"), () => ({
  getOnThisDay: vi.fn(() =>
    Promise.resolve<GetOnThisDayResult>({
      status: "ok",
      days: {
        date: "Oct 24",
        years: [
          {
            year: "2012",
            day: "2012-10-24",
            count: 62,
            top: { artist: "A", track: "T", plays: 1 },
          },
        ],
      },
    }),
  ),
}));

vi.mock(import("@/lib/commentary"), () => ({
  storedTake: vi.fn(async () => "the costume is his personality"),
}));

const renderPage = () => act(async () => render(<OnThisDayPage />));

describe("OnThisDayPage", () => {
  it("marks its tab in the period selector and shows the timeline", async () => {
    await renderPage();

    expect(screen.getByText("on this day")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("Oct 24")).toBeInTheDocument();
    expect(screen.getByText("2012")).toBeInTheDocument();
    expect(storedTake).toHaveBeenCalledWith("on-this-day");
    expect(
      screen.getByText("the costume is his personality"),
    ).toBeInTheDocument();
  });

  it("says the timeline is unavailable when it failed to load", async () => {
    vi.mocked(getOnThisDay).mockResolvedValue({
      status: "error",
      error: "Failed",
    });

    await renderPage();

    expect(
      screen.getByText("This day in past years is temporarily unavailable :("),
    ).toBeInTheDocument();
  });
});
