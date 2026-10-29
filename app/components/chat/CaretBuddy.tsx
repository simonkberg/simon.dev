"use client";

import { useEffect, useReducer } from "react";

type AnimationFrame = readonly [durationSeconds: number, expression: string];
type AnimationFrames = readonly [AnimationFrame, ...AnimationFrame[]];

const STATE_TICK_MS = 100;
const SUCCESS_DURATION_MS = 1500;
const TYPING_TIMEOUT_MS = 3000;
const LONG_MESSAGE_THRESHOLD = 100;

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
  love: [
    [1.2, "♥(◡‿◡)"],
    [0.15, "♡(◕‿◕)"],
    [0.15, "♥(◡‿◡)"],
    [0.4, "♡(◕‿◕)"],
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

interface Clock {
  now: number;
  typedAt: number;
  successUntil: number;
  // The inputs as last seen, to time their changes.
  inputValue: string;
  resultStatus: CaretBuddyInputs["resultStatus"];
}

type ClockAction =
  | { type: "tick"; now: number }
  | ({ type: "see" } & Omit<CaretBuddyInputs, "isPending">);

function clock(state: Clock, action: ClockAction): Clock {
  switch (action.type) {
    case "tick":
      return { ...state, now: action.now };
    case "see":
      return {
        ...state,
        inputValue: action.inputValue,
        resultStatus: action.resultStatus,
        typedAt:
          action.inputValue === state.inputValue ? state.typedAt : state.now,
        successUntil:
          action.resultStatus === "ok" && state.resultStatus !== "ok"
            ? state.now + SUCCESS_DURATION_MS
            : state.successUntil,
      };
  }
}

function useCaretBuddyState({
  inputValue,
  isPending,
  resultStatus,
}: CaretBuddyInputs): BuddyState {
  const [{ now, typedAt, successUntil, ...seen }, dispatch] = useReducer(
    clock,
    { inputValue, resultStatus },
    (inputs): Clock => ({
      ...inputs,
      now: Date.now(),
      typedAt: 0,
      successUntil: 0,
    }),
  );

  useEffect(() => {
    const id = setInterval(
      () => dispatch({ type: "tick", now: Date.now() }),
      STATE_TICK_MS,
    );
    return () => clearInterval(id);
  }, []);

  if (inputValue !== seen.inputValue || resultStatus !== seen.resultStatus) {
    dispatch({ type: "see", inputValue, resultStatus });
  }

  if (resultStatus === "error") return "error";
  if (now < successUntil) return "success";
  if (isPending) return "thinking";
  if (inputValue.includes("`")) return "code";
  if (/\blove\b/i.test(inputValue)) return "love";
  if (inputValue.length > LONG_MESSAGE_THRESHOLD) return "long";
  if (typedAt > 0 && now - typedAt < TYPING_TIMEOUT_MS) return "typing";
  return "idle";
}

interface Animation {
  frames: AnimationFrames;
  index: number;
}

type AnimationAction =
  | { type: "play"; frames: AnimationFrames }
  | { type: "advance" };

function animation(state: Animation, action: AnimationAction): Animation {
  switch (action.type) {
    case "play":
      return { frames: action.frames, index: 0 };
    case "advance":
      return { ...state, index: (state.index + 1) % state.frames.length };
  }
}

function useFrameAnimation(frames: AnimationFrames): string {
  const [state, dispatch] = useReducer(animation, { frames, index: 0 });
  if (frames !== state.frames) dispatch({ type: "play", frames });
  const [duration, expression] = state.frames[state.index] ?? state.frames[0];

  useEffect(() => {
    const timer = setTimeout(
      () => dispatch({ type: "advance" }),
      duration * 1000,
    );
    return () => clearTimeout(timer);
  }, [state, duration]);

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
