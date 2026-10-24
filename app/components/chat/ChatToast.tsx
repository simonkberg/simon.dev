"use client";

import { useDeferredValue, useEffect, useState, ViewTransition } from "react";

export interface ChatToastProps {
  // Compared by identity, so a repeated error shows again.
  result?: { error: string } | undefined;
  duration?: number;
}

export const ChatToast = ({ result, duration = 5000 }: ChatToastProps) => {
  const [isVisible, setIsVisible] = useState(!!result);
  const [prevResult, setPrevResult] = useState(result);
  const deferredResult = useDeferredValue(result);
  const deferredIsVisible = useDeferredValue(isVisible);

  if (result !== prevResult) {
    setPrevResult(result);
    setIsVisible(!!result);
  }

  // result is unread here: it restarts the timer for each new result.
  useEffect(() => {
    if (!isVisible) return;

    const timer = setTimeout(() => setIsVisible(false), duration);

    return () => clearTimeout(timer);
  }, [duration, isVisible, result]);

  if (!deferredIsVisible) return null;

  return (
    <ViewTransition>
      <div
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        className="chat-toast error"
      >
        <span>{deferredResult?.error}</span>
        <button
          type="button"
          onClick={() => setIsVisible(false)}
          aria-label="Close notification"
        >
          &times;
        </button>
      </div>
    </ViewTransition>
  );
};
