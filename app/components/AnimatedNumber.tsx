"use client";

import { formatNumber } from "@/lib/formatNumber";

export interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  // Counts along with the --grow of the element it's in, instead of its own.
  follow?: boolean;
  format?: (shown: number) => string;
}

const counting = new Map<HTMLElement, (grow: number) => void>();
// What each count last showed and counts between, kept across re-renders.
const spans = new WeakMap<
  HTMLElement,
  { from: number; to: number; shown: number }
>();
let frame = 0;

function schedule() {
  cancelAnimationFrame(frame);
  frame = counting.size > 0 ? requestAnimationFrame(tick) : 0;
}

// Reads every count's --grow before writing any, so the writes never force another style recalc.
function tick() {
  const grows = [...counting].map(
    ([span, count]) =>
      [
        count,
        Number.parseFloat(getComputedStyle(span).getPropertyValue("--grow")),
      ] as const,
  );
  for (const [count, grow] of grows) count(grow);
  schedule();
}

/** Counts up as its CSS `--grow` animates from 0 to 1; the server markup already shows the value. */
export const AnimatedNumber = ({
  value,
  decimals = 0,
  follow,
  format = (shown) => formatNumber(shown, decimals),
}: AnimatedNumberProps) => (
  <span
    // Reads --grow rather than timing itself, so a count hydrating mid-animation joins in step.
    ref={(span: HTMLSpanElement) => {
      const last = spans.get(span);
      const count = { from: 0, to: value, shown: value, ...last };
      // A new value counts on from the one shown, growing again unless it follows its row.
      if (last && last.to !== value) {
        Object.assign(count, { from: last.shown, to: value });
        if (!follow)
          for (const animation of span.getAnimations())
            if (
              "animationName" in animation &&
              animation.animationName === "grow"
            )
              animation.currentTime = 0;
      }
      spans.set(span, count);
      counting.set(span, (grow) => {
        const growing = grow < 1;
        count.shown = growing
          ? count.from + (value - count.from) * grow
          : value;
        // A lone text child is React's text content, so this is what it would write.
        span.textContent = format(count.shown);
        span.dataset["counting"] = "";
        if (!growing) counting.delete(span);
      });
      schedule();
      return () => {
        counting.delete(span);
        schedule();
      };
    }}
    className="animated-number"
    data-follow={follow || undefined}
  >
    {format(value)}
  </span>
);
