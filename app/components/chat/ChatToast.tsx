"use client";

import { useDeferredValue, useEffect, useReducer, ViewTransition } from "react";

export interface ChatToastProps {
  // Compared by identity, so a repeated error shows again.
  result?: { error: string } | undefined;
  duration?: number;
}

interface Toast {
  result: { error: string } | undefined;
  open: boolean;
}

type ToastAction =
  | { type: "result"; result: { error: string } | undefined }
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
  useEffect(() => {
    if (!state.open) return;

    const timer = setTimeout(() => dispatch({ type: "close" }), duration);

    return () => clearTimeout(timer);
  }, [duration, state]);

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
