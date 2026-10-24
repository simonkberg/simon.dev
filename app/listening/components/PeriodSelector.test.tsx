import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { periodLabels } from "@/lib/lastfm";

import { PeriodSelector } from "./PeriodSelector";

describe("PeriodSelector", () => {
  it("should render all period options", () => {
    render(<PeriodSelector current="overall" />);

    for (const label of [...Object.values(periodLabels), "on this day"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("should render current period without link", () => {
    render(<PeriodSelector current="7day" />);

    expect(screen.getByText("7 days")).toHaveAttribute("aria-current", "page");
    expect(
      screen.queryByRole("link", { name: "7 days" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["overall", "7 days", "/listening/7day"],
    ["7day", "all time", "/listening"],
    ["overall", "on this day", "/listening/on-this-day"],
    ["on-this-day", "1 year", "/listening/12month"],
  ] as const)("on %s, should link %s to %s", (current, label, href) => {
    render(<PeriodSelector current={current} />);

    expect(screen.getByRole("link", { name: label })).toHaveAttribute(
      "href",
      href,
    );
  });
});
