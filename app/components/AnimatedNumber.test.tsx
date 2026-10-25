import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AnimatedNumber } from "./AnimatedNumber";

describe("AnimatedNumber", () => {
  it("renders the value in server markup", () => {
    expect(renderToString(<AnimatedNumber value={1234.5} decimals={2} />)).toBe(
      '<span class="animated-number">1,234.50</span>',
    );
  });

  it("counts along with the --grow it follows", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
    // happy-dom doesn't inherit custom properties, so this sets the count's own.
    const style = document.createElement("style");
    style.textContent = ".animated-number { --grow: 0.5 }";
    document.head.append(style);
    render(<AnimatedNumber value={100} follow />);
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    const count = screen.getByText("50");
    expect(count).toHaveAttribute("data-counting");

    act(() => {
      style.textContent = ".animated-number { --grow: 1 }";
      vi.advanceTimersToNextFrame();
    });

    expect(count).toHaveTextContent("100");
  });

  it.each([
    { follow: false, restarts: [[0]], committed: "100" },
    { follow: true, restarts: [], committed: "200" },
  ])(
    "counts on from the number shown when its value changes (follow: $follow)",
    ({ follow, restarts, committed }) => {
      vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
      const style = document.createElement("style");
      document.head.append(style);
      const { rerender } = render(
        <AnimatedNumber value={100} follow={follow} />,
      );
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      const count = screen.getByText("100");
      const restart = vi.fn();
      const animation = (properties: object) =>
        Object.defineProperty(properties, "currentTime", { set: restart });
      vi.spyOn(count, "getAnimations").mockReturnValue([
        animation({ animationName: "grow" }) as CSSAnimation,
        // A transition on the same element stays put.
        animation({}) as Animation,
      ]);

      style.textContent = ".animated-number { --grow: 0.5 }";
      rerender(<AnimatedNumber value={200} follow={follow} />);
      expect(count).toHaveTextContent(committed);
      act(() => {
        vi.advanceTimersToNextFrame();
      });

      // Only a count growing on its own restarts and holds its number; one that follows its row grows with it.
      expect(restart.mock.calls).toEqual(restarts);
      expect(count).toHaveTextContent("150");
    },
  );

  it("shows the value once --grow isn't animating", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
    render(<AnimatedNumber value={50} decimals={2} />);
    act(() => {
      vi.advanceTimersToNextFrame();
    });

    expect(screen.getByText("50.00")).toHaveAttribute("data-counting");
  });
});
