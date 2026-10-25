import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { OnThisDay as OnThisDayData } from "@/actions/lastfm";

import { OnThisDay, OnThisDaySkeleton } from "./OnThisDay";

const renderDays = (days: OnThisDayData | undefined) =>
  act(async () => render(<OnThisDay days={Promise.resolve(days)} />));

const top = { artist: "Bicep", track: "Glue" };

describe("OnThisDay", () => {
  it("renders a stop per year played and folds silent years together", async () => {
    await renderDays({
      date: "Oct 24",
      years: [
        { year: "2025", count: 12, top },
        { year: "2024", count: 0 },
        { year: "2023", count: 0 },
        { year: "2022", count: 1, top },
        { year: "2021", count: 0 },
      ],
    });

    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      [
        "Oct 24",
        "2025Glue – Bicep12 plays12 plays",
        "2023–2024nothing played",
        "2022Glue – Bicep1 play1 play",
        "2021nothing played",
      ],
    );
    const [shown, read] = screen.getAllByText("12 plays");
    expect(shown?.parentElement).toHaveAttribute("aria-hidden", "true");
    expect(read).toHaveClass("visually-hidden");
  });

  it("draws the timeline in from the origin, a stop at a time", async () => {
    await renderDays({
      date: "Oct 24",
      years: [
        { year: "2025", count: 12, top },
        { year: "2024", count: 0 },
      ],
    });

    expect(
      [...document.querySelectorAll<HTMLElement>(".timeline li")].map((li) =>
        li.style.getPropertyValue("--index"),
      ),
    ).toEqual(["0", "1", "2"]);
  });

  it("sizes the steps to the stops, so the timeline fits its budget", async () => {
    const days = (years: OnThisDayData["years"]) => (
      <OnThisDay days={Promise.resolve({ date: "Oct 24", years })} />
    );
    const count = () =>
      document
        .querySelector<HTMLElement>(".timeline")
        ?.style.getPropertyValue("--count");
    const { rerender } = await act(async () =>
      render(days([{ year: "2025", count: 12, top }])),
    );
    expect(count()).toBe("2");

    // Same peak, one more stop.
    await act(async () =>
      rerender(
        days([
          { year: "2025", count: 12, top },
          { year: "2024", count: 1, top },
        ]),
      ),
    );

    expect(count()).toBe("3");
  });

  it("renders a notice when the days failed to load", async () => {
    await renderDays(undefined);

    expect(
      screen.getByText("This day in past years is temporarily unavailable :("),
    ).toBeInTheDocument();
  });
});

describe("OnThisDaySkeleton", () => {
  it("announces loading", () => {
    render(<OnThisDaySkeleton />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading");
  });
});
