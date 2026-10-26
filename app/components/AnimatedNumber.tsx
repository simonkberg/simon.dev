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
      // A new value counts on from the one shown.
      const count =
        last?.to === value
          ? last
          : { from: last?.shown ?? 0, to: value, shown: last?.shown ?? value };
      spans.set(span, count);
      const show = (grow: number) => {
        const growing = grow < 1;
        count.shown = growing
          ? count.from + (value - count.from) * grow
          : value;
        const text = format(count.shown);
        // A lone text child is React's text content, so this is what it would write.
        if (span.textContent !== text) span.textContent = text;
        span.dataset["counting"] ??= "";
        if (!growing) counting.delete(span);
      };
      // Only a count growing on its own has a grow to restart; one that follows, or reduced motion, keeps React's value.
      const grow =
        last &&
        count !== last &&
        span
          .getAnimations()
          .find(
            (animation) =>
              "animationName" in animation &&
              animation.animationName === "grow",
          );
      if (grow) {
        grow.currentTime = 0;
        show(0);
      }
      counting.set(span, show);
      schedule();
      return () => {
        counting.delete(span);
        schedule();
      };
    }}
    className="animated-number"
    data-from={format(0)}
    data-follow={follow || undefined}
  >
    {format(value)}
  </span>
);
