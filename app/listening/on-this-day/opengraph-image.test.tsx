import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getOnThisDay } from "@/actions/lastfm";
import { shareCard } from "@/lib/shareCard";

import openGraphImage from "./opengraph-image";

vi.mock(import("@/lib/shareCard"), async (importOriginal) => ({
  ...(await importOriginal()),
  shareCard: vi.fn(),
}));

vi.mock(import("@/actions/lastfm"), () => ({
  getOnThisDay: vi.fn(() =>
    Promise.resolve({
      status: "ok" as const,
      days: {
        date: "Oct 26",
        years: [
          { year: "2025", count: 0 },
          {
            year: "2024",
            count: 62,
            top: { track: "Apartment Story", artist: "The National" },
          },
          { year: "2023", count: 0 },
          {
            year: "2022",
            count: 62,
            top: { track: "Sober to Death", artist: "Car Seat Headrest" },
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
    expect(screen.getByText("(2 of 4 years)")).toBeInTheDocument();
    expect(screen.getByText("Oct 26")).toBeInTheDocument();
    expect(document.body).toHaveTextContent(
      "busiest:2024·Apartment Story–The National·62 plays",
    );
    expect(
      screen.getAllByText(/^(The National|Car Seat Headrest)$/),
    ).toHaveLength(3);
    // Oldest first; silent years only on years divisible by three.
    expect(
      screen.getAllByText(/^’\d\d$/).map((year) => year.textContent),
    ).toEqual(["’22", "’24", "’25"]);
  });

  it("leaves out the busiest year when nothing was played", async () => {
    vi.mocked(getOnThisDay).mockResolvedValue({
      status: "ok",
      days: { date: "Oct 26", years: [{ year: "2025", count: 0 }] },
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
