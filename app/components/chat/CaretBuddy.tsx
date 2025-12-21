"use client";

import { useEffect, useRef, useState } from "react";

const EXPRESSIONS = {
  idle: "(-_-)zzZ",
  typing: "(°▽°)",
  thinking: "(・・?)",
  code: "(⌐■_■)",
  long: "(°o°)",
  error: "(╥_╥)",
  success: "(＾▽＾)",
} as const;

type BuddyState = keyof typeof EXPRESSIONS;

const BLINK_EXPRESSIONS = {
  idle: "(-_-)...",
  typing: "(°_°)",
  thinking: "(・_・)",
  code: "( ■_■)",
  long: "(°_°)",
  error: "(╥︵╥)",
  success: "(＾_＾)",
} as const satisfies Record<BuddyState, string>;

export interface CaretBuddyInputs {
  inputValue: string;
  isPending: boolean;
  resultStatus: "initial" | "ok" | "error";
}

export function useCaretBuddyState(inputs: CaretBuddyInputs): BuddyState {
  const [lastInputChange, setLastInputChange] = useState(0);
  const [successUntil, setSuccessUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Track input changes
  const prevInputValue = useRef(inputs.inputValue);
  useEffect(() => {
    if (inputs.inputValue !== prevInputValue.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: tracking input changes requires setState on prop change
      setLastInputChange(Date.now());
      prevInputValue.current = inputs.inputValue;
    }
  }, [inputs.inputValue]);

  // Set success timer when result changes to "ok"
  const prevResultStatus = useRef(inputs.resultStatus);
  useEffect(() => {
    if (inputs.resultStatus === "ok" && prevResultStatus.current !== "ok") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: tracking result status changes requires setState on prop change
      setSuccessUntil(Date.now() + 1500);
    }
    prevResultStatus.current = inputs.resultStatus;
  }, [inputs.resultStatus]);

  // Tick to update `now` for time-based transitions
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  // Priority-ordered derivation
  if (inputs.resultStatus === "error") return "error";
  if (now < successUntil) return "success";
  if (inputs.isPending) return "thinking";
  if (inputs.inputValue.includes("`")) return "code";
  if (inputs.inputValue.length > 100) return "long";
  if (lastInputChange > 0 && now - lastInputChange < 3000) return "typing";
  return "idle";
}

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
