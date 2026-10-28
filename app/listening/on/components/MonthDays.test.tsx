import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ScrobbleCount } from "@/actions/listening";
import type { Day } from "@/lib/dates";

import { MonthDays } from "./MonthDays";
import { TravelContext } from "./Travel";

const october: ScrobbleCount[] = Array.from({ length: 31 }, (_, index) => ({
  label: `Oct ${index + 1}`,
  count: index === 13 ? 46 : 10,
  current: false,
}));

// October 2012's days, on `date`'s page while it travels to `target`.
const renderDays = (
  days: ScrobbleCount[] | undefined,
  date: Day,
  target?: Day,
) =>
  render(
    <TravelContext
      value={{
        date,
        target,
        travel: vi.fn(),
        scrub: vi.fn(),
        release: vi.fn(),
        going: undefined,
      }}
    >
      <MonthDays month="2012-10" days={days} />
    </TravelContext>,
  );

describe("MonthDays", () => {
  it("links every day of the month, marking the day's own", () => {
    renderDays(october, "2012-10-14");

    expect(screen.getAllByRole("link")).toHaveLength(31);
    expect(
      screen.getByRole("link", { name: "Oct 1: 10 plays" }),
    ).toHaveAttribute("href", "/listening/on/2012/10/01");
    expect(
      screen.getByRole("link", { name: "Oct 14: 46 plays" }),
    ).toHaveAttribute("aria-current", "date");
  });

  it("numbers each week's first day, unless it crowds the day's own", () => {
    renderDays(october, "2012-10-09");

    const ticked = screen
      .getAllByRole("listitem")
      .flatMap((item, index) =>
        item.hasAttribute("data-tick") ? [index + 1] : [],
      );
    expect(ticked).toEqual([1, 9, 15, 22, 29]);
  });

  it("marks a day of the month being travelled to, without dimming", () => {
    const { container } = renderDays(october, "2012-10-14", "2012-10-02");

    expect(
      screen.getByRole("link", { name: "Oct 2: 10 plays" }),
    ).toHaveAttribute("aria-current", "date");
    expect(container.firstChild).not.toHaveAttribute("data-pending");
  });

  it("dims while travelling to another month", () => {
    const { container } = renderDays(october, "2012-10-14", "2008-02-14");

    expect(
      screen.getByRole("link", { name: "Oct 14: 46 plays" }),
    ).toHaveAttribute("aria-current", "date");
    expect(container.firstChild).toHaveAttribute("data-pending");
  });

  it("says the days are unavailable when they failed to load", () => {
    renderDays(undefined, "2012-10-14");

    expect(
      screen.getByText("This month’s days are temporarily unavailable :("),
    ).toBeInTheDocument();
  });
});
