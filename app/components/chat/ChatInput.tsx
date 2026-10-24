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
import { type CommandResult, messageText, runCommand } from "./commands";

function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const keyDownHandler = (event: KeyboardEvent) => {
      // A tooltip's Escape closes only the tooltip.
      if (event.key === "Escape" && !event.defaultPrevented) onEscape();
    };
    window.addEventListener("keydown", keyDownHandler);
    return () => {
      window.removeEventListener("keydown", keyDownHandler);
    };
  }, [active, onEscape]);
}

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

  function showCommand(text: string, command: CommandResult) {
    if (command.status === "error") {
      setResult(command);
      return;
    }
    setResult({ status: "ok" });
    setOutput(command.output ? { command: text, lines: command.output } : null);
    setInputValue("");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inputValue.trim()) return;
    const form = event.currentTarget;

    const message = messageText(inputValue);
    if (message === null) {
      const text = inputValue.trim();
      const command = runCommand(text);
      if (command instanceof Promise) {
        startTransition(async () => {
          const result = await command.catch((): CommandResult => ({
            status: "error",
            error: `Couldn't run ${text}. Try again.`,
          }));
          startTransition(() => showCommand(text, result));
        });
      } else {
        showCommand(text, command);
      }
      return;
    }

    setOutput(null);
    startTransition(async () => {
      const formData = new FormData(form);
      formData.set("text", message);
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
    if (replyToId) inputRef.current?.focus();
  }, [replyToId]);

  useEscape(!!replyToId, () => setReplyToId(null));
  useEscape(!!output, () => setOutput(null));

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
