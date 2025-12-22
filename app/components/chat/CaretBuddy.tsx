"use client";

import { useEffect, useRef, useState } from "react";

type AnimationFrame = readonly [durationSeconds: number, expression: string];
type AnimationFrames = readonly [AnimationFrame, ...AnimationFrame[]];

const ANIMATIONS = {
  idle: [
    // Z wave: zzz → Zzz → zZz → zzZ → zzz
    [0.5, "(-_-)zzz"], // quiet sleep
    [0.4, "(-_-)Zzz"], // snore starts
    [0.4, "(-_-)zZz"], // snore middle
    [0.4, "(-_-)zzZ"], // snore peak
    [0.5, "(-_-)zzz"], // quiet again
    // Inhale - mouth opens
    [0.4, "(-_-)..."], // breath pause
    [0.4, "(-o-)..."], // inhaling
    [0.5, "(-O-)..."], // deep breath
    // Exhale - mouth closes
    [0.4, "(-o-)..."], // exhaling
    [0.4, "(-_-)..."], // settling
  ],
  typing: [
    [0.9, "(°▽°)"], // happy
    [1.2, "(°ᴗ°)"], // soft smile
    [0.8, "(°▽°)"], // back to happy
    [0.15, "(°_°)"], // blink
  ],
  thinking: [
    [1.1, "(・・?)"], // thinking
    [0.9, "(・.・?)"], // pondering
    [1.0, "(・・?)"], // back
    [0.15, "(・_・)"], // blink
  ],
  code: [
    [1.4, "(⌐■_■)"], // cool
    [1.2, "(■_■⌐)"], // head bob
    [1.3, "(⌐■_■)"], // back
    [0.15, "( ■_■)"], // glasses slip
  ],
  long: [
    [0.9, "(°o°)"], // amazed
    [0.8, "(°O°)"], // bigger gasp
    [1.1, "(°o°)"], // back
    [0.15, "(°_°)"], // blink
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

  // Tick to update `now` for time-based transitions
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  // Track input changes - adjust state during render using `now` (pure)
  const [prevInputValue, setPrevInputValue] = useState(inputs.inputValue);
  if (inputs.inputValue !== prevInputValue) {
    setPrevInputValue(inputs.inputValue);
    setLastInputChange(now);
  }

  // Set success timer when result changes to "ok" - adjust state during render
  const [prevResultStatus, setPrevResultStatus] = useState(inputs.resultStatus);
  if (inputs.resultStatus === "ok" && prevResultStatus !== "ok") {
    setSuccessUntil(now + 1500);
  }
  if (inputs.resultStatus !== prevResultStatus) {
    setPrevResultStatus(inputs.resultStatus);
  }

  // Priority-ordered derivation
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

  // Reset when frames change
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
      const frame = frames[idx];

      // Defensive: reset if out of bounds
      if (!frame) {
        frameIndexRef.current = 0;
        setExpression(frames[0][1]);
        startTime = timestamp;
      } else if (timestamp - startTime >= frame[0] * 1000) {
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
