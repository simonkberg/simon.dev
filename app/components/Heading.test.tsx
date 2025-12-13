import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Heading } from "./Heading";

describe("Heading", () => {
  it.each([
    { level: 1 },
    { level: 2 },
    { level: 3 },
    { level: 4 },
    { level: 5 },
    { level: 6 },
  ] as const)("renders h$level element when level is $level", ({ level }) => {
    render(<Heading level={level}>Test</Heading>);
    expect(screen.getByRole("heading", { level })).toBeInTheDocument();
  });

  it("renders children content", () => {
    render(<Heading level={2}>Test Heading</Heading>);
    expect(screen.getByText("Test Heading")).toBeInTheDocument();
  });

  it("renders with id when provided", () => {
    render(
      <Heading level={2} id="test-heading">
        Test Heading
      </Heading>,
    );
    expect(screen.getByRole("heading")).toHaveAttribute("id", "test-heading");
  });
});
