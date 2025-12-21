import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CaretBuddy,
  type CaretBuddyInputs,
  useCaretBuddyState,
  useFrameAnimation,
} from "./CaretBuddy";

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
      }),
    );

    expect(result.current).toBe("idle");
  });

  it("returns error when resultStatus is error", () => {
    const { result } = renderHook(() =>
      useCaretBuddyState({
        inputValue: "",
        isPending: false,
        resultStatus: "error",
      }),
    );

    expect(result.current).toBe("error");
  });

  it("returns thinking when isPending is true", () => {
    const { result } = renderHook(() =>
      useCaretBuddyState({
        inputValue: "",
        isPending: true,
        resultStatus: "initial",
      }),
    );

    expect(result.current).toBe("thinking");
  });

  it("returns code when input contains backticks", () => {
    const { result } = renderHook(() =>
      useCaretBuddyState({
        inputValue: "check this `code`",
        isPending: false,
        resultStatus: "initial",
      }),
    );

    expect(result.current).toBe("code");
  });

  it("returns long when input exceeds 100 characters", () => {
    const { result } = renderHook(() =>
      useCaretBuddyState({
        inputValue: "a".repeat(101),
        isPending: false,
        resultStatus: "initial",
      }),
    );

    expect(result.current).toBe("long");
  });

  it("returns typing when input changes", () => {
    const { result, rerender } = renderHook(
      (props) => useCaretBuddyState(props),
      {
        initialProps: {
          inputValue: "",
          isPending: false,
          resultStatus: "initial" as const,
        },
      },
    );

    expect(result.current).toBe("idle");

    rerender({
      inputValue: "h",
      isPending: false,
      resultStatus: "initial" as const,
    });

    expect(result.current).toBe("typing");
  });

  it("transitions from typing to idle after 3 seconds", async () => {
    const { result, rerender } = renderHook(
      (props) => useCaretBuddyState(props),
      {
        initialProps: {
          inputValue: "",
          isPending: false,
          resultStatus: "initial" as const,
        },
      },
    );

    rerender({
      inputValue: "hello",
      isPending: false,
      resultStatus: "initial" as const,
    });

    expect(result.current).toBe("typing");

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current).toBe("idle");
  });

  it("returns success when resultStatus changes to ok", () => {
    const { result, rerender } = renderHook(
      (props: CaretBuddyInputs) => useCaretBuddyState(props),
      {
        initialProps: {
          inputValue: "",
          isPending: false,
          resultStatus: "initial",
        },
      },
    );

    rerender({ inputValue: "", isPending: false, resultStatus: "ok" });

    expect(result.current).toBe("success");
  });

  it("transitions from success to idle after 1.5 seconds", async () => {
    const { result, rerender } = renderHook(
      (props: CaretBuddyInputs) => useCaretBuddyState(props),
      {
        initialProps: {
          inputValue: "",
          isPending: false,
          resultStatus: "initial",
        },
      },
    );

    rerender({ inputValue: "", isPending: false, resultStatus: "ok" });

    expect(result.current).toBe("success");

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(result.current).toBe("idle");
  });

  describe("priority ordering", () => {
    it("error takes priority over success", () => {
      const { result, rerender } = renderHook(
        (props: CaretBuddyInputs) => useCaretBuddyState(props),
        {
          initialProps: {
            inputValue: "",
            isPending: false,
            resultStatus: "initial",
          },
        },
      );

      // First get into success state
      rerender({ inputValue: "", isPending: false, resultStatus: "ok" });

      expect(result.current).toBe("success");

      // Now error should override
      rerender({ inputValue: "", isPending: false, resultStatus: "error" });

      expect(result.current).toBe("error");
    });

    it("success takes priority over thinking", () => {
      const { result, rerender } = renderHook(
        (props: CaretBuddyInputs) => useCaretBuddyState(props),
        {
          initialProps: {
            inputValue: "",
            isPending: false,
            resultStatus: "initial",
          },
        },
      );

      rerender({ inputValue: "", isPending: true, resultStatus: "ok" });

      expect(result.current).toBe("success");
    });

    it("thinking takes priority over code", () => {
      const { result } = renderHook(() =>
        useCaretBuddyState({
          inputValue: "`code`",
          isPending: true,
          resultStatus: "initial",
        }),
      );

      expect(result.current).toBe("thinking");
    });

    it("code takes priority over long", () => {
      const { result } = renderHook(() =>
        useCaretBuddyState({
          inputValue: "`" + "a".repeat(100),
          isPending: false,
          resultStatus: "initial",
        }),
      );

      expect(result.current).toBe("code");
    });

    it("long takes priority over typing", async () => {
      const { result, rerender } = renderHook(
        (props: CaretBuddyInputs) => useCaretBuddyState(props),
        {
          initialProps: {
            inputValue: "",
            isPending: false,
            resultStatus: "initial",
          },
        },
      );

      rerender({
        inputValue: "a".repeat(101),
        isPending: false,
        resultStatus: "initial",
      });

      expect(result.current).toBe("long");
    });
  });
});

describe("useFrameAnimation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    let frameId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frameId++;
      setTimeout(() => cb(performance.now()), 16);
      return frameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      // no-op for tests
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns first frame expression initially", () => {
    const frames: [number, string][] = [
      [1.0, "first"],
      [0.5, "second"],
    ];

    const { result } = renderHook(() => useFrameAnimation(frames));

    expect(result.current).toBe("first");
  });

  it("advances to next frame after duration", async () => {
    const frames: [number, string][] = [
      [0.1, "first"],
      [0.1, "second"],
    ];

    const { result } = renderHook(() => useFrameAnimation(frames));

    expect(result.current).toBe("first");

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current).toBe("second");
  });

  it("loops back to first frame after last", async () => {
    const frames: [number, string][] = [
      [0.05, "first"],
      [0.05, "second"],
    ];

    const { result } = renderHook(() => useFrameAnimation(frames));

    await act(async () => {
      vi.advanceTimersByTime(50); // to second
    });

    expect(result.current).toBe("second");

    await act(async () => {
      vi.advanceTimersByTime(50); // back to first
    });

    expect(result.current).toBe("first");
  });

  it("resets to first frame when frames change", async () => {
    const frames1: [number, string][] = [
      [0.05, "a1"],
      [0.05, "a2"],
    ];
    const frames2: [number, string][] = [
      [0.05, "b1"],
      [0.05, "b2"],
    ];

    const { result, rerender } = renderHook(
      (frames) => useFrameAnimation(frames),
      { initialProps: frames1 },
    );

    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    expect(result.current).toBe("a2");

    rerender(frames2);

    expect(result.current).toBe("b1");
  });
});
