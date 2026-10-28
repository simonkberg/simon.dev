import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ScrobbleCount } from "@/actions/listening";

import { MonthDays } from "./MonthDays";

const october: ScrobbleCount[] = Array.from({ length: 31 }, (_, index) => ({
  label: `Oct ${index + 1}`,
  count: index === 13 ? 46 : 10,
  current: false,
}));

describe("MonthDays", () => {
  it("links every day of the month, marking the day's own", () => {
    render(<MonthDays day="2012-10-14" days={october} />);

    expect(screen.getAllByRole("link")).toHaveLength(31);
    expect(
      screen.getByRole("link", { name: "Oct 1: 10 plays" }),
    ).toHaveAttribute("href", "/listening/on/2012-10-01");
    expect(
      screen.getByRole("link", { name: "Oct 14: 46 plays" }),
    ).toHaveAttribute("aria-current", "date");
  });

  it("says the days are unavailable when they failed to load", () => {
    render(<MonthDays day="2012-10-14" days={undefined} />);

    expect(
      screen.getByText("This month’s days are temporarily unavailable :("),
    ).toBeInTheDocument();
  });
});
