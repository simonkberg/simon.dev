"use client";

import {
  type Dispatch,
  FormEvent,
  type PropsWithChildren,
  useEffect,
  useReducer,
  useRef,
  useTransition,
} from "react";

import { postChatMessage, PostChatMessageResult } from "@/actions/chat";
import { TooltipButton } from "@/components/Tooltip";

import { CaretBuddy } from "./CaretBuddy";
import type { ReplyAction } from "./ChatMessage";
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

// Tells the others while the visitor types a message, never what; their post or clearing it ends it.
function useTypingSignal() {
  const sentAt = useRef(0);
  // One at a time, so a stop can't land before the ping it ends.
  const sending = useRef<Promise<unknown>>(Promise.resolve());
  const send = (method: "POST" | "DELETE") => {
    // A lost ping only ends the indicator early, and a lost stop lets it run out.
    sending.current = sending.current.then(() =>
      fetch("/api/chat/typing", { method, keepalive: true }).catch(() => {}),
    );
  };
  return {
    typed(text: string) {
      if (!messageText(text)?.trim()) {
        if (sentAt.current !== 0) send("DELETE");
        sentAt.current = 0;
        return;
      }
      if (Date.now() - sentAt.current < TYPING_PING_MS) return;
      sentAt.current = Date.now();
      send("POST");
    },
    // Posting ends the typing on the server, so the next message pings at once.
    posted() {
      sentAt.current = 0;
    },
  };
}

interface Draft {
  text: string;
  result: PostChatMessageResult;
  output: { command: string; lines: readonly string[] } | null;
}

type DraftAction =
  | { type: "edit"; text: string }
  | { type: "ran"; command: string; result: CommandResult }
  | { type: "sent"; result: PostChatMessageResult }
  | { type: "closeOutput" };

function draft(state: Draft, action: DraftAction): Draft {
  switch (action.type) {
    case "edit":
      return { ...state, text: action.text };
    case "ran": {
      const { command, result } = action;
      if (result.status === "error") return { ...state, result };
      return {
        text: "",
        result: { status: "initial" },
        output: result.output ? { command, lines: result.output } : null,
      };
    }
    case "sent":
      return {
        ...state,
        text: action.result.status === "ok" ? "" : state.text,
        result: action.result,
      };
    case "closeOutput":
      return state.output ? { ...state, output: null } : state;
  }
}

export interface ChatInputProps extends PropsWithChildren {
  replyToId: string | null;
  dispatchReply: Dispatch<ReplyAction>;
}

export const ChatInput = ({
  replyToId,
  dispatchReply,
  children,
}: ChatInputProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [{ text: inputValue, result, output }, dispatch] = useReducer(draft, {
    text: "",
    result: { status: "initial" },
    output: null,
  });
  const [pending, startTransition] = useTransition();
  const typing = useTypingSignal();
  const changeInput = (text: string) => {
    dispatch({ type: "edit", text });
    typing.typed(text);
  };

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
          startTransition(() =>
            dispatch({ type: "ran", command: text, result }),
          );
        });
      } else {
        dispatch({ type: "ran", command: text, result: command });
      }
      return;
    }

    dispatch({ type: "closeOutput" });
    startTransition(async () => {
      const formData = new FormData(form);
      formData.set("text", message);
      if (replyToId) {
        formData.append("replyToId", replyToId);
      }
      const result = await postChatMessage(formData);

      // Nested startTransition required: after await, we're outside the original transition context
      startTransition(() => {
        if (result.status === "ok") {
          dispatchReply({ type: "cancel" });
          typing.posted();
        }
        dispatch({ type: "sent", result });
      });
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

  useEscape(!!replyToId, () => dispatchReply({ type: "cancel" }));
  useEscape(!!output, () => dispatch({ type: "closeOutput" }));

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
            onClick={() => dispatch({ type: "closeOutput" })}
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
