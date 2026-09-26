import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Subtitle } from "./Subtitle";

describe("Subtitle", () => {
  it("renders children content", () => {
    render(<Subtitle>Test subtitle</Subtitle>);
    expect(screen.getByText("Test subtitle")).toBeInTheDocument();
  });

  it("adds an extra class name", () => {
    render(<Subtitle className="now-playing">Now</Subtitle>);
    expect(screen.getByText("Now")).toHaveClass("subtitle", "now-playing");
  });
});
