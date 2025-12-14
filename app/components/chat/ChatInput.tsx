"use client";

import { FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { requestFormReset } from "react-dom";

import { postChatMessage, PostChatMessageResult } from "@/actions/chat";

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
        });
      }

      setResult(result);
    });
  }

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
          />
        </div>
      </form>
    </>
  );
};
