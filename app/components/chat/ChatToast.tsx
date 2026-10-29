"use client";

import { useDeferredValue, useReducer, ViewTransition } from "react";

import { useTimeout } from "@/components/useTimeout";

export interface ChatToastProps {
  // Compared by identity, so a repeated error shows again.
  result?: { error: string } | undefined;
  duration?: number;
}

interface Toast {
  result: ChatToastProps["result"];
  open: boolean;
}

type ToastAction =
  | { type: "result"; result: ChatToastProps["result"] }
  | { type: "close" };

function toast(state: Toast, action: ToastAction): Toast {
  switch (action.type) {
    case "result":
      return { result: action.result, open: !!action.result };
    case "close":
      return { ...state, open: false };
  }
}

export const ChatToast = ({ result, duration = 5000 }: ChatToastProps) => {
  const [state, dispatch] = useReducer(toast, { result, open: !!result });
  const shown = useDeferredValue(state);

  if (result !== state.result) dispatch({ type: "result", result });

  // Each result is a new state, so it restarts the timer.
  useTimeout(
    () => dispatch({ type: "close" }),
    state.open ? duration : undefined,
    state,
  );

  if (!shown.open) return null;

  return (
    <ViewTransition>
      <div
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        className="chat-toast error"
      >
        <span>{shown.result?.error}</span>
        <button
          type="button"
          onClick={() => dispatch({ type: "close" })}
          aria-label="Close notification"
        >
          &times;
        </button>
      </div>
    </ViewTransition>
  );
};
