"use client";

import { useReducer } from "react";

import { ANIMATIONS, useFrameAnimation } from "@/components/faces";
import { useTimeout } from "@/components/useTimeout";

const SUCCESS_DURATION_MS = 1500;
const TYPING_TIMEOUT_MS = 3000;
const LONG_MESSAGE_THRESHOLD = 100;

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
