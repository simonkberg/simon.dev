"use client";

import { useEffect, useRef, useState } from "react";

type AnimationFrame = readonly [durationSeconds: number, expression: string];
type AnimationFrames = readonly [AnimationFrame, ...AnimationFrame[]];

const ANIMATIONS = {
  idle: [
    // Z wave
    [0.5, "(-_-)zzz"],
    [0.4, "(-_-)Zzz"],
    [0.4, "(-_-)zZz"],
    [0.4, "(-_-)zzZ"],
    [0.5, "(-_-)zzz"],
    // Inhale
    [0.4, "(-_-)..."],
    [0.4, "(-o-)..."],
    [0.5, "(-O-)..."],
    // Exhale
    [0.4, "(-o-)..."],
    [0.4, "(-_-)..."],
  ],
  typing: [
    [0.9, "(°▽°)"],
    [1.2, "(°ᴗ°)"],
    [0.8, "(°▽°)"],
    [0.15, "(°_°)"],
  ],
  thinking: [
    [1.1, "(・・?)"],
    [0.9, "(・.・?)"],
    [1.0, "(・・?)"],
    [0.15, "(・_・)"],
  ],
  code: [
    [1.4, "(⌐■_■)"],
    [1.2, "(■_■⌐)"],
    [1.3, "(⌐■_■)"],
    [0.15, "( ■_■)"],
  ],
  long: [
    [0.9, "(°o°)"],
    [0.8, "(°O°)"],
    [1.1, "(°o°)"],
    [0.15, "(°_°)"],
  ],
  error: [
    [1.0, "(╥_╥)"],
    [0.15, "(╥︵╥)"],
  ],
  success: [
    [1.0, "(＾▽＾)"],
    [0.15, "(＾_＾)"],
  ],
} as const satisfies Record<string, AnimationFrames>;

type BuddyState = keyof typeof ANIMATIONS;

interface CaretBuddyInputs {
  inputValue: string;
  isPending: boolean;
  resultStatus: "initial" | "ok" | "error";
}

function useCaretBuddyState(inputs: CaretBuddyInputs): BuddyState {
  const [now, setNow] = useState(() => Date.now());
  const [lastInputChange, setLastInputChange] = useState(0);
  const [successUntil, setSuccessUntil] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  const [prevInputValue, setPrevInputValue] = useState(inputs.inputValue);
  if (inputs.inputValue !== prevInputValue) {
    setPrevInputValue(inputs.inputValue);
    setLastInputChange(now);
  }

  const [prevResultStatus, setPrevResultStatus] = useState(inputs.resultStatus);
  if (inputs.resultStatus === "ok" && prevResultStatus !== "ok") {
    setSuccessUntil(now + 1500);
  }
  if (inputs.resultStatus !== prevResultStatus) {
    setPrevResultStatus(inputs.resultStatus);
  }

  if (inputs.resultStatus === "error") return "error";
  if (now < successUntil) return "success";
  if (inputs.isPending) return "thinking";
  if (inputs.inputValue.includes("`")) return "code";
  if (inputs.inputValue.length > 100) return "long";
  if (lastInputChange > 0 && now - lastInputChange < 3000) return "typing";
  return "idle";
}

function useFrameAnimation(frames: AnimationFrames): string {
  const frameIndexRef = useRef(0);
  const [expression, setExpression] = useState(frames[0][1]);

  const [prevFrames, setPrevFrames] = useState(frames);
  if (frames !== prevFrames) {
    setPrevFrames(frames);
    frameIndexRef.current = 0;
    setExpression(frames[0][1]);
  }

  useEffect(() => {
    let startTime: number | null = null;
    let raf: number;

    const animate = (timestamp: number) => {
      startTime ??= timestamp;
      const idx = frameIndexRef.current;

      if (timestamp - startTime >= frames[idx]![0] * 1000) {
        const next = (idx + 1) % frames.length;
        frameIndexRef.current = next;
        setExpression(frames[next]![1]);
        startTime = timestamp;
      }

      raf = requestAnimationFrame(animate);
    };

    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [frames]);

  return expression;
}

export interface CaretBuddyProps {
  inputValue: string;
  isPending: boolean;
  resultStatus: "initial" | "ok" | "error";
}

export const CaretBuddy = ({
  inputValue,
  isPending,
  resultStatus,
}: CaretBuddyProps) => {
  const state = useCaretBuddyState({ inputValue, isPending, resultStatus });
  const frames = ANIMATIONS[state];
  const expression = useFrameAnimation(frames);

  return (
    <span className="caret-buddy" aria-hidden="true">
      {expression}
    </span>
  );
};
