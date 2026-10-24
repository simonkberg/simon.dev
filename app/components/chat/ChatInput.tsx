"use client";

import {
  FormEvent,
  type PropsWithChildren,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { requestFormReset } from "react-dom";

import { postChatMessage, PostChatMessageResult } from "@/actions/chat";
import { TooltipButton } from "@/components/Tooltip";

import { CaretBuddy } from "./CaretBuddy";
import { ChatSuggestInput } from "./ChatSuggestInput";
import { ChatToast } from "./ChatToast";
import { isCommand, runCommand } from "./commands";

export interface ChatInputProps extends PropsWithChildren {
  replyToId: string | null;
  setReplyToId: (id: string | null) => void;
}

export const ChatInput = ({
  replyToId,
  setReplyToId,
  children,
}: ChatInputProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<PostChatMessageResult>({
    status: "initial",
  });
  const [pending, startTransition] = useTransition();
  const [inputValue, setInputValue] = useState("");
  const [output, setOutput] = useState<{
    command: string;
    lines: readonly string[];
  } | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inputValue.trim()) return;
    const form = event.currentTarget;

    if (isCommand(inputValue)) {
      const command = runCommand(inputValue);
      if (command.status === "error") {
        setResult(command);
        return;
      }
      setResult({ status: "initial" });
      setOutput(
        command.output
          ? { command: inputValue.trim(), lines: command.output }
          : null,
      );
      setInputValue("");
      return;
    }

    setOutput(null);
    startTransition(async () => {
      const formData = new FormData(form);
      // A doubled slash sends one, so a message can start with it.
      if (inputValue.startsWith("//")) {
        formData.set("text", inputValue.slice(1));
      }
      if (replyToId) {
        formData.append("replyToId", replyToId);
      }
      const result = await postChatMessage(formData);

      if (result.status === "ok") {
        // Nested startTransition required: after await, we're outside the original transition context
        startTransition(() => {
          requestFormReset(form);
          setReplyToId(null);
          setInputValue("");
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
        // A tooltip's Escape closes only the tooltip.
        if (event.key === "Escape" && !event.defaultPrevented) {
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

  useEffect(() => {
    if (!output) return;
    const keyDownHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setOutput(null);
    };
    window.addEventListener("keydown", keyDownHandler);
    return () => {
      window.removeEventListener("keydown", keyDownHandler);
    };
  }, [output]);

  return (
    <>
      <ChatToast
        variant={result.status === "error" ? "error" : "default"}
        message={
          !pending && result.status === "error" ? result.error : undefined
        }
      />
      {output && (
        <div className="chat-output" role="status" aria-live="polite">
          <p className="echo">{output.command}</p>
          <pre>{output.lines.join("\n")}</pre>
          <TooltipButton
            tooltip="Close output"
            className="clear"
            onClick={() => setOutput(null)}
          >
            &times;
          </TooltipButton>
        </div>
      )}
      <form onSubmit={onSubmit} className="chat-input">
        <div className="wrapper">
          <ChatSuggestInput
            name="text"
            placeholder={`Write a ${replyToId ? "reply" : "message"}...`}
            disabled={pending}
            className="input"
            ref={inputRef}
            value={inputValue}
            onValueChange={setInputValue}
            autoComplete="off"
          />
          <CaretBuddy
            inputValue={inputValue}
            isPending={pending}
            resultStatus={result.status}
          />
        </div>
        {children}
      </form>
    </>
  );
};
