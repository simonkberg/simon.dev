import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AnimatedNumber } from "./AnimatedNumber";

describe("AnimatedNumber", () => {
  it("should render a span element", () => {
    render(<AnimatedNumber value={100} />);

    expect(screen.getByText(/\d+/)).toBeInTheDocument();
  });

  it("should format with specified decimals", () => {
    render(<AnimatedNumber value={50} decimals={2} />);

    // The animation starts at 0, so we check for a number pattern
    expect(screen.getByText(/\d+\.\d{2}/)).toBeInTheDocument();
  });

  it("should format as integer by default", () => {
    render(<AnimatedNumber value={100} />);

    // Default decimals=0 means no decimal point
    const span = screen.getByText(/\d+/);
    expect(span.textContent).not.toContain(".");
  });
});
