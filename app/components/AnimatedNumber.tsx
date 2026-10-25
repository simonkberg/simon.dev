"use client";

import { useEffect, useRef } from "react";

import { formatNumber } from "@/lib/formatNumber";

export interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  // Counts along with the --grow of the element it's in, instead of its own.
  follow?: boolean;
  format?: (shown: number) => string;
}

/** Counts up as its CSS `--grow` animates from 0 to 1; the server markup already shows the value. */
export const AnimatedNumber = ({
  value,
  decimals = 0,
  follow,
  format = (shown) => formatNumber(shown, decimals),
}: AnimatedNumberProps) => {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const span = ref.current;
    const text = span?.firstChild;
    if (!span || !text) return;
    span.dataset["counting"] = "";
    let frame = 0;
    const count = () => {
      // Read from the style, so a count that hydrates mid-animation joins it in step.
      const grow = Number.parseFloat(
        getComputedStyle(span).getPropertyValue("--grow"),
      );
      const growing = grow < 1;
      text.nodeValue = format(growing ? value * grow : value);
      if (growing) frame = requestAnimationFrame(count);
    };
    count();
    return () => cancelAnimationFrame(frame);
  }, [value, format]);

  return (
    <span ref={ref} className="count" data-follow={follow || undefined}>
      {format(value)}
    </span>
  );
};
