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

  it("has aria-hidden attribute for accessibility", async () => {
    await act(async () => {
      render(<CaretBuddy {...defaultProps} />);
    });

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
