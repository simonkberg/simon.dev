"use client";

import { useDeferredValue, useEffect, useState, ViewTransition } from "react";

export interface ChatToastProps {
  variant?: "default" | "error";
  message?: string | undefined;
  duration?: number;
}

export const ChatToast = ({
  variant = "default",
  message = undefined,
  duration = 5000,
}: ChatToastProps) => {
  const [isVisible, setIsVisible] = useState(!!message);
  const [prevMessage, setPrevMessage] = useState(message);
  const deferredMessage = useDeferredValue(message);
  const deferredIsVisible = useDeferredValue(isVisible);

  if (message !== prevMessage) {
    setPrevMessage(message);
    setIsVisible(!!message);
  }

  useEffect(() => {
    if (!isVisible) return;

    const timer = setTimeout(() => setIsVisible(false), duration);

    return () => clearTimeout(timer);
  }, [duration, isVisible]);

  if (!deferredIsVisible) return null;

  return (
    <ViewTransition>
      <div
        role="status"
        aria-live={variant === "error" ? "assertive" : "polite"}
        aria-atomic="true"
        className={`chat-toast ${variant}`}
      >
        <span>{deferredMessage}</span>
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
