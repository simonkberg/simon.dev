"use client";

import { useReducer } from "react";

import { useTimeout } from "@/components/useTimeout";

type AnimationFrame = readonly [durationSeconds: number, expression: string];
export type AnimationFrames = readonly [AnimationFrame, ...AnimationFrame[]];

const SUCCESS_DURATION_MS = 1500;
const TYPING_TIMEOUT_MS = 3000;
const LONG_MESSAGE_THRESHOLD = 100;

export const ANIMATIONS = {
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
  // Counts each new ok, to restart the success wait.
  oks: number;
  // The inputs as last seen, to notice their changes.
  inputValue: string;
  resultStatus: CaretBuddyInputs["resultStatus"];
}

type MoodsAction =
  | ({ type: "see" } & Omit<CaretBuddyInputs, "isPending">)
  | { type: "expire"; mood: "typing" | "success" };

function moods(state: Moods, action: MoodsAction): Moods {
  switch (action.type) {
    case "see": {
      const ok = action.resultStatus === "ok" && state.resultStatus !== "ok";
      return {
        inputValue: action.inputValue,
        resultStatus: action.resultStatus,
        typing: state.typing || action.inputValue !== state.inputValue,
        success: state.success || ok,
        oks: ok ? state.oks + 1 : state.oks,
      };
    }
    case "expire":
      return { ...state, [action.mood]: false };
  }
}

function useCaretBuddyState({
  inputValue,
  isPending,
  resultStatus,
}: CaretBuddyInputs): BuddyState {
  const [{ typing, success, oks, ...seen }, dispatch] = useReducer(moods, {
    inputValue,
    resultStatus,
    typing: false,
    success: false,
    oks: 0,
  });

  if (inputValue !== seen.inputValue || resultStatus !== seen.resultStatus) {
    dispatch({ type: "see", inputValue, resultStatus });
  }

  useTimeout(
    () => dispatch({ type: "expire", mood: "typing" }),
    typing ? TYPING_TIMEOUT_MS : undefined,
    seen.inputValue,
  );
  useTimeout(
    () => dispatch({ type: "expire", mood: "success" }),
    success ? SUCCESS_DURATION_MS : undefined,
    oks,
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

export function useFrameAnimation(frames: AnimationFrames): string {
  const [state, dispatch] = useReducer(animation, {
    frames,
    index: 0,
    frame: frames[0],
  });
  if (frames !== state.frames) dispatch({ type: "play", frames });
  const [duration, expression] = state.frame;

  useTimeout(() => dispatch({ type: "advance" }), duration * 1000, state);

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
