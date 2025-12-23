import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CaretBuddy } from "./CaretBuddy";

describe("CaretBuddy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const defaultProps = {
    inputValue: "",
    isPending: false,
    resultStatus: "initial" as const,
  };

  it("has aria-hidden attribute for accessibility", () => {
    render(<CaretBuddy {...defaultProps} />);

    const buddy = document.querySelector(".caret-buddy");
    expect(buddy).toHaveAttribute("aria-hidden", "true");
  });

  describe("state derivation", () => {
    it("shows idle when no input and no activity", () => {
      render(<CaretBuddy {...defaultProps} />);
      expect(screen.getByText("(-_-)zzz")).toBeInTheDocument();
    });

    it("shows error when resultStatus is error", () => {
      render(<CaretBuddy {...defaultProps} resultStatus="error" />);
      expect(screen.getByText("(╥_╥)")).toBeInTheDocument();
    });

    it("shows thinking when isPending is true", () => {
      render(<CaretBuddy {...defaultProps} isPending={true} />);
      expect(screen.getByText("(・・?)")).toBeInTheDocument();
    });

    it("shows code when input contains backticks", () => {
      render(<CaretBuddy {...defaultProps} inputValue="check `code`" />);
      expect(screen.getByText("(⌐■_■)")).toBeInTheDocument();
    });

    it("shows love when input contains the word love", () => {
      render(<CaretBuddy {...defaultProps} inputValue="I love this" />);
      expect(screen.getByText("♥(◡‿◡)")).toBeInTheDocument();
    });

    it("shows long when input exceeds 100 characters", () => {
      render(<CaretBuddy {...defaultProps} inputValue={"a".repeat(101)} />);
      expect(screen.getByText("(°o°)")).toBeInTheDocument();
    });

    it("shows typing when input changes", () => {
      const { rerender } = render(<CaretBuddy {...defaultProps} />);
      rerender(<CaretBuddy {...defaultProps} inputValue="h" />);
      expect(screen.getByText("(°▽°)")).toBeInTheDocument();
    });

    it("shows success when resultStatus changes to ok", () => {
      const { rerender } = render(<CaretBuddy {...defaultProps} />);
      rerender(<CaretBuddy {...defaultProps} resultStatus="ok" />);
      expect(screen.getByText("(＾▽＾)")).toBeInTheDocument();
    });
  });

  describe("state priority", () => {
    it("error takes priority over success", () => {
      const { rerender } = render(<CaretBuddy {...defaultProps} />);
      rerender(<CaretBuddy {...defaultProps} resultStatus="ok" />);
      expect(screen.getByText("(＾▽＾)")).toBeInTheDocument();

      rerender(<CaretBuddy {...defaultProps} resultStatus="error" />);
      expect(screen.getByText("(╥_╥)")).toBeInTheDocument();
    });

    it("thinking takes priority over code", () => {
      render(
        <CaretBuddy {...defaultProps} inputValue="`code`" isPending={true} />,
      );
      expect(screen.getByText("(・・?)")).toBeInTheDocument();
    });

    it("code takes priority over love", () => {
      render(<CaretBuddy {...defaultProps} inputValue="`love`" />);
      expect(screen.getByText("(⌐■_■)")).toBeInTheDocument();
    });

    it("love takes priority over long", () => {
      render(
        <CaretBuddy {...defaultProps} inputValue={"love " + "a".repeat(100)} />,
      );
      expect(screen.getByText("♥(◡‿◡)")).toBeInTheDocument();
    });
  });

  describe("time-based transitions", () => {
    it("transitions from typing to idle after 3 seconds", () => {
      const { rerender } = render(<CaretBuddy {...defaultProps} />);
      rerender(<CaretBuddy {...defaultProps} inputValue="hello" />);
      expect(screen.getByText("(°▽°)")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(screen.getByText("(-_-)zzz")).toBeInTheDocument();
    });

    it("transitions from success to idle after 1.5 seconds", () => {
      const { rerender } = render(<CaretBuddy {...defaultProps} />);
      rerender(<CaretBuddy {...defaultProps} resultStatus="ok" />);
      expect(screen.getByText("(＾▽＾)")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1500);
      });

      expect(screen.getByText("(-_-)zzz")).toBeInTheDocument();
    });
  });

  describe("frame animation", () => {
    it("advances to next frame after duration elapses", () => {
      render(<CaretBuddy {...defaultProps} resultStatus="error" />);
      // error frames: [1.0, "(╥_╥)"], [0.15, "(╥︵╥)"]
      expect(screen.getByText("(╥_╥)")).toBeInTheDocument();

      act(() => {
        // First rAF starts the animation loop
        vi.advanceTimersToNextFrame();
        // Advance time by 1 second
        vi.advanceTimersByTime(1000);
        // Second rAF processes the elapsed time
        vi.advanceTimersToNextFrame();
      });

      expect(screen.getByText("(╥︵╥)")).toBeInTheDocument();
    });

    it("loops back to first frame after last", () => {
      render(<CaretBuddy {...defaultProps} resultStatus="error" />);

      act(() => {
        vi.advanceTimersToNextFrame(); // start loop
        vi.advanceTimersByTime(1000); // → frame 1
        vi.advanceTimersToNextFrame(); // process
        vi.advanceTimersByTime(150); // → frame 0 (loops)
        vi.advanceTimersToNextFrame(); // process
      });

      expect(screen.getByText("(╥_╥)")).toBeInTheDocument();
    });

    it("resets to first frame when state changes", () => {
      const { rerender } = render(
        <CaretBuddy {...defaultProps} resultStatus="error" />,
      );

      act(() => {
        vi.advanceTimersToNextFrame(); // start loop
        vi.advanceTimersByTime(1000); // → frame 1 of error
        vi.advanceTimersToNextFrame(); // process
      });
      expect(screen.getByText("(╥︵╥)")).toBeInTheDocument();

      rerender(<CaretBuddy {...defaultProps} isPending={true} />);

      // Should show frame 0 of thinking, not carry over frame index
      expect(screen.getByText("(・・?)")).toBeInTheDocument();
    });
  });
});
