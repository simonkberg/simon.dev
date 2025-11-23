import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PeriodSelector } from "./PeriodSelector";

describe("PeriodSelector", () => {
  it("should render all period options", () => {
    render(<PeriodSelector current="overall" />);

    expect(screen.getByText("7 days")).toBeInTheDocument();
    expect(screen.getByText("1 month")).toBeInTheDocument();
    expect(screen.getByText("3 months")).toBeInTheDocument();
    expect(screen.getByText("6 months")).toBeInTheDocument();
    expect(screen.getByText("1 year")).toBeInTheDocument();
    expect(screen.getByText("all time")).toBeInTheDocument();
  });

  it("should render current period without link", () => {
    render(<PeriodSelector current="7day" />);

    expect(screen.getByText("7 days")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "7 days" }),
    ).not.toBeInTheDocument();
  });

  it("should render non-current periods as links", () => {
    render(<PeriodSelector current="overall" />);

    const link = screen.getByRole("link", { name: "7 days" });
    expect(link).toHaveAttribute("href", "/listening/7day");
  });

  it("should link to /listening for overall period", () => {
    render(<PeriodSelector current="7day" />);

    const link = screen.getByRole("link", { name: "all time" });
    expect(link).toHaveAttribute("href", "/listening");
  });
});
