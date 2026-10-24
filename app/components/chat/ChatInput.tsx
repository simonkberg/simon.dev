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

// The server keeps a typist twice this long, so one late ping doesn't drop them.
const TYPING_PING_MS = 2_000;

// Tells the others while the visitor types a message, never what; their post ends it.
function useTypingSignal() {
  const sentAt = useRef(0);
  return (text: string) => {
    if (!messageText(text)?.trim()) {
      // Posting ends the typing on the server, so the next message pings at once.
      sentAt.current = 0;
      return;
    }
    if (Date.now() - sentAt.current < TYPING_PING_MS) return;
    sentAt.current = Date.now();
    // A lost ping only ends the indicator early.
    fetch("/api/chat/typing", { method: "POST", keepalive: true }).catch(
      () => {},
    );
  };
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
  const signalTyping = useTypingSignal();
  const changeInput = (value: string) => {
    setInputValue(value);
    signalTyping(value);
  };
  const [output, setOutput] = useState<{
    command: string;
    lines: readonly string[];
  } | null>(null);

  function showCommand(text: string, command: CommandResult) {
    if (command.status === "error") {
      setResult(command);
      return;
    }
    setResult({ status: "initial" });
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
          const result = await command;
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
          changeInput("");
        });
      }

      setResult(result);
    });
  }

  // Disabling the input while pending blurs it, so give focus back once done.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) inputRef.current?.focus();
    wasPending.current = pending;
  }, [pending]);

  useEffect(() => {
    if (replyToId) inputRef.current?.focus();
  }, [replyToId]);

  useEscape(!!replyToId, () => setReplyToId(null));
  useEscape(!!output, () => setOutput(null));

  return (
    <>
      <ChatToast
        result={!pending && result.status === "error" ? result : undefined}
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
            onValueChange={changeInput}
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
