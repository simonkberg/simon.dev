import { Globals } from "@react-spring/web";
import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { OnThisDay as OnThisDayData } from "@/actions/lastfm";
import { settled } from "@/mocks/promise";

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
    expect(shown).toHaveAttribute("aria-hidden", "true");
    expect(read).toHaveClass("visually-hidden");
  });

  it("draws the timeline in from the origin when mounted on the client", async () => {
    Globals.assign({ skipAnimation: false });

    await renderDays({
      date: "Oct 24",
      years: [
        { year: "2025", count: 12, top },
        { year: "2024", count: 0 },
      ],
    });

    const grows = [
      ...document.querySelectorAll<HTMLElement>(".timeline li"),
    ].map((li) => Number(li.style.getPropertyValue("--grow")));
    expect(Math.max(...grows)).toBeLessThan(1);
    expect(grows.at(-1)).toBe(0);
    expect(screen.getByText("0 plays")).toBeInTheDocument();
  });

  it("renders the whole timeline in server markup", () => {
    const html = renderToString(
      <OnThisDay
        days={settled({
          date: "Oct 24",
          years: [{ year: "2025", count: 12, top }],
        })}
      />,
    );

    expect(html).toContain("--grow:1");
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
