"use client";

import { useEffect, useReducer } from "react";

type AnimationFrame = readonly [durationSeconds: number, expression: string];
type AnimationFrames = readonly [AnimationFrame, ...AnimationFrame[]];

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

interface Moods {
  typing: boolean;
  success: boolean;
  // The inputs as last seen, to notice their changes.
  inputValue: string;
  resultStatus: CaretBuddyInputs["resultStatus"];
}

type MoodsAction =
  | ({ type: "see" } & Omit<CaretBuddyInputs, "isPending">)
  | { type: "expire"; mood: "typing" | "success" };

function moods(state: Moods, action: MoodsAction): Moods {
  switch (action.type) {
    case "see":
      return {
        inputValue: action.inputValue,
        resultStatus: action.resultStatus,
        typing: state.typing || action.inputValue !== state.inputValue,
        success:
          state.success ||
          (action.resultStatus === "ok" && state.resultStatus !== "ok"),
      };
    case "expire":
      return { ...state, [action.mood]: false };
  }
}

function useExpiry(
  dispatch: (action: MoodsAction) => void,
  mood: "typing" | "success",
  active: boolean,
  ms: number,
  // Restarts the wait when it changes.
  restart?: unknown,
) {
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => dispatch({ type: "expire", mood }), ms);
    return () => clearTimeout(timer);
  }, [dispatch, mood, active, ms, restart]);
}

function useCaretBuddyState({
  inputValue,
  isPending,
  resultStatus,
}: CaretBuddyInputs): BuddyState {
  const [{ typing, success, ...seen }, dispatch] = useReducer(moods, {
    inputValue,
    resultStatus,
    typing: false,
    success: false,
  });

  if (inputValue !== seen.inputValue || resultStatus !== seen.resultStatus) {
    dispatch({ type: "see", inputValue, resultStatus });
  }

  useExpiry(dispatch, "typing", typing, TYPING_TIMEOUT_MS, seen.inputValue);
  useExpiry(
    dispatch,
    "success",
    success,
    SUCCESS_DURATION_MS,
    seen.resultStatus,
  );

  if (resultStatus === "error") return "error";
  if (success) return "success";
  if (isPending) return "thinking";
  if (inputValue.includes("`")) return "code";
  if (/\blove\b/i.test(inputValue)) return "love";
  if (inputValue.length > LONG_MESSAGE_THRESHOLD) return "long";
  if (typing) return "typing";
  return "idle";
}

interface Animation {
  frames: AnimationFrames;
  index: number;
  frame: AnimationFrame;
}

type AnimationAction =
  | { type: "play"; frames: AnimationFrames }
  | { type: "advance" };

function animation(state: Animation, action: AnimationAction): Animation {
  switch (action.type) {
    case "play":
      return { frames: action.frames, index: 0, frame: action.frames[0] };
    case "advance": {
      const index = state.index + 1;
      const frame = state.frames[index];
      return frame
        ? { ...state, index, frame }
        : { ...state, index: 0, frame: state.frames[0] };
    }
  }
}

function useFrameAnimation(frames: AnimationFrames): string {
  const [state, dispatch] = useReducer(animation, {
    frames,
    index: 0,
    frame: frames[0],
  });
  if (frames !== state.frames) dispatch({ type: "play", frames });
  const [duration, expression] = state.frame;

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
