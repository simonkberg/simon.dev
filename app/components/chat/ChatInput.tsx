"use client";

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { requestFormReset } from "react-dom";

import { postChatMessage, PostChatMessageResult } from "@/actions/chat";

import { BuddyState, CaretBuddy } from "./CaretBuddy";
import { ChatToast } from "./ChatToast";

export interface ChatInputProps {
  replyToId: string | null;
  setReplyToId: (id: string | null) => void;
}

export const ChatInput = ({ replyToId, setReplyToId }: ChatInputProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<PostChatMessageResult>({
    status: "initial",
  });
  const [pending, startTransition] = useTransition();

  // Buddy state tracking
  const [inputValue, setInputValue] = useState("");
  const [lastKeystroke, setLastKeystroke] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    startTransition(async () => {
      const formData = new FormData(form);
      if (replyToId) {
        formData.append("replyToId", replyToId);
      }
      const result = await postChatMessage(formData);

      if (result.status === "ok") {
        startTransition(() => {
          requestFormReset(form);
          setReplyToId(null);
          setInputValue("");
        });
      }

      setResult(result);
    });
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    setInputValue(event.target.value);
    setLastKeystroke(Date.now());
    setIsTyping(true);
  }

  // Derive buddy state
  function getBuddyState(): BuddyState {
    if (result.status === "error") return "error";
    if (showSuccess) return "success";
    if (pending) return "thinking";
    if (inputValue.includes("`")) return "code";
    if (inputValue.length > 100) return "long";
    if (isTyping) return "typing";
    return "idle";
  }

  // Typing timeout - transition to idle after 3s
  useEffect(() => {
    if (lastKeystroke > 0 && isTyping) {
      const timer = setTimeout(() => setIsTyping(false), 3000);
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [lastKeystroke, isTyping]);

  // Success timeout - show success for 1.5s after successful submission
  useEffect(() => {
    if (result.status === "ok" && !showSuccess) {
      const timer = setTimeout(() => {
        setShowSuccess(true);
      }, 0);
      return () => {
        clearTimeout(timer);
      };
    }
    if (showSuccess) {
      const timer = setTimeout(() => {
        setShowSuccess(false);
      }, 1500);
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [result, showSuccess]);

  useEffect(() => {
    if (!pending && result.status !== "initial") {
      inputRef.current?.focus();
    }
  }, [pending, result.status]);

  useEffect(() => {
    if (replyToId) {
      inputRef.current?.focus();
      const keyDownHandler = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          setReplyToId(null);
        }
      };
      window.addEventListener("keydown", keyDownHandler);
      return () => {
        window.removeEventListener("keydown", keyDownHandler);
      };
    }

    return;
  }, [replyToId, setReplyToId]);

  return (
    <>
      <ChatToast
        variant={result.status === "error" ? "error" : "default"}
        message={
          !pending && result.status === "error" ? result.error : undefined
        }
      />
      <form onSubmit={onSubmit} className="chat-input">
        <div className="wrapper">
          <input
            name="text"
            placeholder={`Write a ${replyToId ? "reply" : "message"}...`}
            disabled={pending}
            className="input"
            ref={inputRef}
            value={inputValue}
            onChange={onChange}
          />
          <CaretBuddy state={getBuddyState()} />
        </div>
      </form>
    </>
  );
};
