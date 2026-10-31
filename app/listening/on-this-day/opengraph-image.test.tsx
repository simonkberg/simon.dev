import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type GetOnThisDayResult, getOnThisDay } from "@/actions/listening";
import { shareCard } from "@/lib/shareCard";

import openGraphImage from "./opengraph-image";

vi.mock(import("@/lib/shareCard"), async (importOriginal) => ({
  ...(await importOriginal()),
  shareCard: vi.fn(),
}));

vi.mock(import("@/actions/listening"), () => ({
  getOnThisDay: vi.fn(() =>
    Promise.resolve<GetOnThisDayResult>({
      status: "ok",
      days: {
        date: "Oct 26",
        years: [
          { year: "2027", day: "2027-10-26", count: 0 },
          { year: "2026", day: "2026-10-26", count: 0 },
          { year: "2025", day: "2025-10-26", count: 0 },
          {
            year: "2024",
            day: "2024-10-26",
            count: 62,
            top: { track: "Apartment Story", artist: "The National", plays: 9 },
          },
          { year: "2023", day: "2023-10-26", count: 0 },
          {
            year: "2022",
            day: "2022-10-26",
            count: 62,
            top: {
              track: "Sober to Death",
              artist: "Car Seat Headrest",
              plays: 7,
            },
          },
        ],
      },
    }),
  ),
}));

const renderCard = async () => {
  await openGraphImage();
  const [[, body] = []] = vi.mocked(shareCard).mock.calls;
  await act(async () => render(body));
};

describe("opengraph-image", () => {
  it("draws the day's busiest year, the newest on a tie, and every year's top artist", async () => {
    await renderCard();

    expect(shareCard).toHaveBeenCalledWith(
      { window: "listening" },
      expect.anything(),
    );
    expect(screen.getByText("(2 of 6 years)")).toBeInTheDocument();
    expect(screen.getByText("Oct 26")).toBeInTheDocument();
    expect(document.body).toHaveTextContent(
      "busiest:2024·Apartment Story–The National·62 plays",
    );
    expect(
      screen.getAllByText(/^(The National|Car Seat Headrest)$/),
    ).toHaveLength(3);
    // Oldest first; a silent run shows only its first and last year.
    expect(
      screen.getAllByText(/^’\d\d$/).map((year) => year.textContent),
    ).toEqual(["’22", "’23", "’24", "’25", "’27"]);
  });

  it("leaves out the busiest year when nothing was played", async () => {
    vi.mocked(getOnThisDay).mockResolvedValue({
      status: "ok",
      days: {
        date: "Oct 26",
        years: [{ year: "2025", day: "2025-10-26", count: 0 }],
      },
    });

    await renderCard();

    expect(screen.getByText("(0 of 1 years)")).toBeInTheDocument();
    expect(screen.queryByText("busiest:")).not.toBeInTheDocument();
  });

  it("says the days are unavailable when they fail to load", async () => {
    vi.mocked(getOnThisDay).mockResolvedValue({
      status: "error",
      error: "Failed",
    });

    await renderCard();

    expect(
      screen.getByText("This day in past years is temporarily unavailable :("),
    ).toBeInTheDocument();
    expect(screen.queryByText(/years\)$/)).not.toBeInTheDocument();
  });
});
