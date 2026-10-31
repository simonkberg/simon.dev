import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DayInYear, GetOnThisDayResult } from "@/actions/listening";

import { OnThisDayTeaser } from "./OnThisDayTeaser";

const renderTeaser = (result: GetOnThisDayResult) =>
  act(async () =>
    render(<OnThisDayTeaser onThisDay={Promise.resolve(result)} />),
  );

const days = (years: DayInYear[]): GetOnThisDayResult => ({
  status: "ok",
  days: { date: "Oct 24", years },
});

describe("OnThisDayTeaser", () => {
  it("shows the past year with the most plays and a top track", async () => {
    await renderTeaser(
      days([
        {
          year: "2025",
          day: "2025-10-24",
          count: 45,
          top: { artist: "Destroyer", track: "A", plays: 3 },
        },
        { year: "2024", day: "2024-10-24", count: 80 },
        {
          year: "2012",
          day: "2012-10-24",
          count: 62,
          top: { artist: "Lana Del Rey", track: "B", plays: 21 },
        },
      ]),
    );

    expect(
      screen.getByText("On this day in 2012 (62 plays)"),
    ).toBeInTheDocument();
    expect(screen.getByRole("paragraph")).toHaveTextContent(
      "B – Lana Del Rey (21 plays). See every year.",
    );
  });

  it.each([
    [
      "nothing was played",
      days([{ year: "2024", day: "2024-10-24", count: 0 }]),
    ],
    ["the days failed to load", { status: "error", error: "Failed" } as const],
  ])("renders nothing when %s", async (_, result) => {
    const { container } = await renderTeaser(result);

    expect(container).toBeEmptyDOMElement();
  });
});
