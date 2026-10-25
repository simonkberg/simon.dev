import {
  type SpringConfig,
  type SpringValue,
  useSprings,
} from "@react-spring/web";
import { useState } from "react";

import { formatNumber } from "@/lib/formatNumber";

import { useMotion } from "./useMotion";

/** One `grow` spring per item, from 0 to 1 after its delay; the server markup already shows the end state. */
export const useGrow = (
  count: number,
  delay: (index: number) => number,
  config?: SpringConfig,
) => {
  const animate = useMotion();
  const [from] = useState(animate ? 0 : 1);
  const [springs] = useSprings(count, (index) => ({
    from: { grow: from },
    to: { grow: 1 },
    delay: delay(index),
    config: { clamp: true, ...config },
  }));
  return springs;
};

export const countUp = (
  value: number,
  grow: SpringValue<number> | undefined,
  format: (shown: number) => string = formatNumber,
) => grow?.to((g) => format(Math.round(value * g)));
