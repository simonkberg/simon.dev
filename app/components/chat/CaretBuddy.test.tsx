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

  describe("expressions", () => {
    it.each([
      ["idle", "(-_-)zzZ"],
      ["typing", "(°▽°)"],
      ["thinking", "(・・?)"],
      ["code", "(⌐■_■)"],
      ["long", "(°o°)"],
      ["error", "(╥_╥)"],
      ["success", "(＾▽＾)"],
    ] as const)("renders %s state as %s", (state, expression) => {
      render(<CaretBuddy state={state} />);

      expect(screen.getByText(expression)).toBeInTheDocument();
    });
  });
});
