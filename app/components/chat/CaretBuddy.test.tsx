import { act, render, screen, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CaretBuddy, useCaretBuddyState } from "./CaretBuddy";

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

  describe("blink animation", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Mock Math.random to return predictable value (0.5 = halfway between min and max)
      vi.spyOn(Math, "random").mockReturnValue(0.5);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("blinks after 2-5 seconds showing alternate expression", async () => {
      await act(async () => {
        render(<CaretBuddy state="idle" />);
      });

      expect(screen.getByText("(-_-)zzZ")).toBeInTheDocument();

      // Math.random() mocked to 0.5, so delay = 2000 + 0.5 * 3000 = 3500ms
      await act(async () => {
        vi.advanceTimersByTime(3500);
      });

      // Should show blink expression
      expect(screen.getByText("(-_-)...")).toBeInTheDocument();
    });

    it("returns to main expression after 150ms blink", async () => {
      await act(async () => {
        render(<CaretBuddy state="idle" />);
      });

      // Trigger blink (Math.random() mocked to 0.5, so delay = 3500ms)
      await act(async () => {
        vi.advanceTimersByTime(3500);
      });

      expect(screen.getByText("(-_-)...")).toBeInTheDocument();

      // Wait for blink to end
      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      expect(screen.getByText("(-_-)zzZ")).toBeInTheDocument();
    });
  });
});

describe("useCaretBuddyState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns idle when no input and no activity", () => {
    const { result } = renderHook(() =>
      useCaretBuddyState({
        inputValue: "",
        isPending: false,
        resultStatus: "initial",
      })
    );

    expect(result.current).toBe("idle");
  });

  it("returns error when resultStatus is error", () => {
    const { result } = renderHook(() =>
      useCaretBuddyState({
        inputValue: "",
        isPending: false,
        resultStatus: "error",
      })
    );

    expect(result.current).toBe("error");
  });

  it("returns thinking when isPending is true", () => {
    const { result } = renderHook(() =>
      useCaretBuddyState({
        inputValue: "",
        isPending: true,
        resultStatus: "initial",
      })
    );

    expect(result.current).toBe("thinking");
  });

  it("returns code when input contains backticks", () => {
    const { result } = renderHook(() =>
      useCaretBuddyState({
        inputValue: "check this `code`",
        isPending: false,
        resultStatus: "initial",
      })
    );

    expect(result.current).toBe("code");
  });

  it("returns long when input exceeds 100 characters", () => {
    const { result } = renderHook(() =>
      useCaretBuddyState({
        inputValue: "a".repeat(101),
        isPending: false,
        resultStatus: "initial",
      })
    );

    expect(result.current).toBe("long");
  });
});
