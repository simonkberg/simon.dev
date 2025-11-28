"use client";

import { animated, useSpring } from "@react-spring/web";

export interface AnimatedNumberProps {
  value: number;
  decimals?: number;
}

export const AnimatedNumber = ({
  value,
  decimals = 0,
}: AnimatedNumberProps) => {
  const spring = useSpring({ from: { value: 0 }, to: { value } });

  return (
    <animated.span>
      {spring.value.to((val) => val.toFixed(decimals))}
    </animated.span>
  );
};
