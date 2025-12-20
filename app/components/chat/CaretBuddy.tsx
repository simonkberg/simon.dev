"use client";

import { useEffect, useState } from "react";

const EXPRESSIONS = {
  idle: "(-_-)zzZ",
  typing: "(°▽°)",
  thinking: "(・・?)",
  code: "(⌐■_■)",
  long: "(°o°)",
  error: "(╥_╥)",
  success: "(＾▽＾)",
} as const;

const BLINK_EXPRESSIONS = {
  idle: "(-_-)...",
  typing: "(°_°)",
  thinking: "(・_・)",
  code: "( ■_■)",
  long: "(°_°)",
  error: "(╥︵╥)",
  success: "(＾_＾)",
} as const;

type BuddyState = keyof typeof EXPRESSIONS;

interface CaretBuddyProps {
  state: BuddyState;
}

export const CaretBuddy = ({ state }: CaretBuddyProps) => {
  const [isBlinking, setIsBlinking] = useState(false);

  useEffect(() => {
    let blinkEndTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleNextBlink = () => {
      const delay = 2000 + Math.random() * 3000;
      return setTimeout(() => {
        setIsBlinking(true);
        blinkEndTimer = setTimeout(() => {
          setIsBlinking(false);
          blinkTimer = scheduleNextBlink();
        }, 150);
      }, delay);
    };

    let blinkTimer = scheduleNextBlink();

    return () => {
      clearTimeout(blinkTimer);
      clearTimeout(blinkEndTimer);
    };
  }, [state]);

  const expression = isBlinking ? BLINK_EXPRESSIONS[state] : EXPRESSIONS[state];

  return (
    <span className="caret-buddy" aria-hidden="true">
      {expression}
    </span>
  );
};

export type { BuddyState };
