import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CaretBuddy } from "./CaretBuddy";

describe("CaretBuddy", () => {
  it("renders the idle expression by default", () => {
    render(<CaretBuddy state="idle" />);

    expect(screen.getByText("(-_-)zzZ")).toBeInTheDocument();
  });

  it("has aria-hidden attribute for accessibility", () => {
    render(<CaretBuddy state="idle" />);

    const buddy = screen.getByText("(-_-)zzZ");
    expect(buddy).toHaveAttribute("aria-hidden", "true");
  });
});
