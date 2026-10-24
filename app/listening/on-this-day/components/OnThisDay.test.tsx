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
        "2025Glue – Bicep12 plays",
        "2023–2024nothing played",
        "2022Glue – Bicep1 play",
        "2021nothing played",
      ],
    );
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
