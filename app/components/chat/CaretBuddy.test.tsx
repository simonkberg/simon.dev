import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CaretBuddy } from "./CaretBuddy";

describe("CaretBuddy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    let frameId = 0;
    let mockCurrentTime = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frameId++;
      setTimeout(() => {
        mockCurrentTime += 16;
        cb(mockCurrentTime);
      }, 16);
      return frameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const defaultProps = {
    inputValue: "",
    isPending: false,
    resultStatus: "initial" as const,
  };

  it("has aria-hidden attribute for accessibility", async () => {
    await act(async () => {
      render(<CaretBuddy {...defaultProps} />);
    });

    const buddy = document.querySelector(".caret-buddy");
    expect(buddy).toHaveAttribute("aria-hidden", "true");
  });

  describe("state derivation", () => {
    it("shows idle expression when no input and no activity", async () => {
      await act(async () => {
        render(<CaretBuddy {...defaultProps} />);
      });

      expect(screen.getByText("(-_-)zzz")).toBeInTheDocument();
    });

    it("shows error expression when resultStatus is error", async () => {
      await act(async () => {
        render(<CaretBuddy {...defaultProps} resultStatus="error" />);
      });

      expect(screen.getByText("(╥_╥)")).toBeInTheDocument();
    });

    it("shows thinking expression when isPending is true", async () => {
      await act(async () => {
        render(<CaretBuddy {...defaultProps} isPending={true} />);
      });

      expect(screen.getByText("(・・?)")).toBeInTheDocument();
    });

    it("shows code expression when input contains backticks", async () => {
      await act(async () => {
        render(<CaretBuddy {...defaultProps} inputValue="check `code`" />);
      });

      expect(screen.getByText("(⌐■_■)")).toBeInTheDocument();
    });

    it("shows long expression when input exceeds 100 characters", async () => {
      await act(async () => {
        render(<CaretBuddy {...defaultProps} inputValue={"a".repeat(101)} />);
      });

      expect(screen.getByText("(°o°)")).toBeInTheDocument();
    });

    it("shows typing expression when input changes", async () => {
      const { rerender } = await act(async () => {
        return render(<CaretBuddy {...defaultProps} />);
      });

      await act(async () => {
        rerender(<CaretBuddy {...defaultProps} inputValue="h" />);
      });

      expect(screen.getByText("(°▽°)")).toBeInTheDocument();
    });

    it("shows success expression when resultStatus changes to ok", async () => {
      const { rerender } = await act(async () => {
        return render(<CaretBuddy {...defaultProps} />);
      });

      await act(async () => {
        rerender(<CaretBuddy {...defaultProps} resultStatus="ok" />);
      });

      expect(screen.getByText("(＾▽＾)")).toBeInTheDocument();
    });
  });

  describe("state priority", () => {
    it("error takes priority over success", async () => {
      const { rerender } = await act(async () => {
        return render(<CaretBuddy {...defaultProps} />);
      });

      // First transition to success
      await act(async () => {
        rerender(<CaretBuddy {...defaultProps} resultStatus="ok" />);
      });

      expect(screen.getByText("(＾▽＾)")).toBeInTheDocument();

      // Then show error takes priority
      await act(async () => {
        rerender(<CaretBuddy {...defaultProps} resultStatus="error" />);
      });

      expect(screen.getByText("(╥_╥)")).toBeInTheDocument();
    });

    it("thinking takes priority over code", async () => {
      await act(async () => {
        render(
          <CaretBuddy {...defaultProps} inputValue="`code`" isPending={true} />,
        );
      });

      expect(screen.getByText("(・・?)")).toBeInTheDocument();
    });

    it("code takes priority over long", async () => {
      await act(async () => {
        render(
          <CaretBuddy {...defaultProps} inputValue={"`" + "a".repeat(100)} />,
        );
      });

      expect(screen.getByText("(⌐■_■)")).toBeInTheDocument();
    });
  });

  describe("animation cycling", () => {
    it("cycles through expression variations over time", async () => {
      const { rerender } = await act(async () => {
        return render(<CaretBuddy {...defaultProps} />);
      });

      // Trigger typing state
      await act(async () => {
        rerender(<CaretBuddy {...defaultProps} inputValue="hi" />);
      });

      // Initially shows main typing expression
      expect(screen.getByText("(°▽°)")).toBeInTheDocument();

      // After 0.9 seconds, shows soft smile
      await act(async () => {
        vi.advanceTimersByTime(900);
      });
      expect(screen.getByText("(°ᴗ°)")).toBeInTheDocument();

      // After another 1.2 seconds, back to happy
      await act(async () => {
        vi.advanceTimersByTime(1200);
      });
      expect(screen.getByText("(°▽°)")).toBeInTheDocument();
    });
  });

  describe("time-based transitions", () => {
    it("transitions from typing to idle after 3 seconds of no input", async () => {
      const { rerender } = await act(async () => {
        return render(<CaretBuddy {...defaultProps} />);
      });

      await act(async () => {
        rerender(<CaretBuddy {...defaultProps} inputValue="hello" />);
      });

      expect(screen.getByText("(°▽°)")).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      expect(screen.getByText("(-_-)zzz")).toBeInTheDocument();
    });

    it("transitions from success to idle after 1.5 seconds", async () => {
      const { rerender } = await act(async () => {
        return render(<CaretBuddy {...defaultProps} />);
      });

      await act(async () => {
        rerender(<CaretBuddy {...defaultProps} resultStatus="ok" />);
      });

      expect(screen.getByText("(＾▽＾)")).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(1500);
      });

      expect(screen.getByText("(-_-)zzz")).toBeInTheDocument();
    });
  });
});
