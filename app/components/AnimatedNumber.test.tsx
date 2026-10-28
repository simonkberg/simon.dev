import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnimatedNumber } from "./AnimatedNumber";

// happy-dom doesn't inherit custom properties, so this sets the count's own.
const setGrow = (grow: number) => {
  const style =
    document.querySelector("style") ??
    document.head.appendChild(document.createElement("style"));
  style.textContent = `.animated-number { --grow: ${grow} }`;
};

const nextFrame = () =>
  act(() => {
    vi.advanceTimersToNextFrame();
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
});

describe("AnimatedNumber", () => {
  it("renders the value and the 0 it counts from in server markup", () => {
    expect(renderToString(<AnimatedNumber value={1234.5} decimals={2} />)).toBe(
      '<span data-hydrating="" class="animated-number" data-from="0.00">1,234.50</span>',
    );
  });

  it("isn't hydrating when rendered on the client", () => {
    render(<AnimatedNumber value={100} />);

    expect(screen.getByText("100")).not.toHaveAttribute("data-hydrating");
  });

  it("counts along with the --grow it follows", () => {
    setGrow(0.5);
    render(<AnimatedNumber value={100} follow />);
    nextFrame();
    const count = screen.getByText("50");
    expect(count).toHaveAttribute("data-counting");

    setGrow(1);
    nextFrame();

    expect(count).toHaveTextContent("100");
  });

  it.each([
    { growing: true, restarts: [[0]], committed: "100" },
    { growing: false, restarts: [], committed: "200" },
  ])(
    "counts on from the number shown when its value changes (growing: $growing)",
    ({ growing, restarts, committed }) => {
      const { rerender } = render(<AnimatedNumber value={100} />);
      nextFrame();
      const count = screen.getByText("100");
      const restart = vi.fn();
      const animation = (properties: object) =>
        Object.defineProperty(properties, "currentTime", { set: restart });
      vi.spyOn(count, "getAnimations").mockReturnValue([
        // A transition on the same element stays put.
        animation({}) as Animation,
        // A count that follows its row, or reduced motion, has no grow of its own.
        ...(growing
          ? [animation({ animationName: "grow" }) as CSSAnimation]
          : []),
      ]);

      setGrow(0.5);
      rerender(<AnimatedNumber value={200} />);
      expect(count).toHaveTextContent(committed);
      nextFrame();

      // Only a count with its own grow restarts and holds its number.
      expect(restart.mock.calls).toEqual(restarts);
      expect(count).toHaveTextContent("150");
    },
  );

  it("shows the value once --grow isn't animating", () => {
    render(<AnimatedNumber value={50} decimals={2} />);
    nextFrame();

    expect(screen.getByText("50.00")).toHaveAttribute("data-counting");
  });
});
