"use client";

import { type FocusEvent, type KeyboardEvent, useReducer } from "react";

import type { Message } from "@/lib/discord/api";

import { arrowFocus } from "./arrowFocus";
import { ChatMessage } from "./ChatMessage";

const messageIds = (messages: Message[]): string[] =>
  messages.flatMap((message) => [message.id, ...messageIds(message.replies)]);

const messageElements = (root: Element) => [
  ...root.querySelectorAll<HTMLElement>(".chat-message"),
];

function setTabStop(root: Element, id: string | undefined) {
  for (const message of messageElements(root)) {
    const active = message.dataset["id"] === id;
    message.tabIndex = active ? 0 : -1;
    for (const control of message.querySelectorAll<HTMLElement>(
      "a[href], button, [role='button']",
    )) {
      if (!active) control.tabIndex = -1;
      // A spoiler is a span, focusable only with a tabindex.
      else if (control.matches("[role='button']")) control.tabIndex = 0;
      // Not 0: Safari would then tab to these even where it skips every other button and link.
      else control.removeAttribute("tabindex");
    }
  }
}

interface ChatHistoryMessagesProps {
  messages: Message[];
  replyToId: string | null;
  onReply: (id: string) => void;
}

interface Shown {
  message: Message;
  motion?: "enter" | "leave";
}

// Keeps each removed message where it was, to slide out.
function follow(shown: readonly Shown[], messages: readonly Message[]) {
  const motions = new Map(
    shown.map(({ message, motion }) => [message.id, motion]),
  );
  const next = messages.map((message): Shown => {
    const motion = motions.get(message.id);
    return {
      message,
      motion: !motions.has(message.id) || motion === "leave" ? "enter" : motion,
    };
  });
  const ids = new Set(messages.map(({ id }) => id));
  for (const [index, { message }] of shown.entries()) {
    if (ids.has(message.id)) continue;
    const before = shown[index - 1]?.message.id;
    const at = next.findIndex((entry) => entry.message.id === before) + 1;
    next.splice(at, 0, { message, motion: "leave" });
  }
  return next;
}

interface Showing {
  messages: readonly Message[];
  shown: readonly Shown[];
}

type ShowingAction =
  | { type: "follow"; messages: readonly Message[] }
  | { type: "slidOut"; id: string };

function showing(state: Showing, action: ShowingAction): Showing {
  switch (action.type) {
    case "follow":
      return {
        messages: action.messages,
        shown: follow(state.shown, action.messages),
      };
    case "slidOut":
      return {
        ...state,
        shown: state.shown.filter(({ message }) => message.id !== action.id),
      };
  }
}

// Calls done once li's slide ends or is cancelled, unless cleaned up first.
function whenSlidOut(li: HTMLLIElement, done: () => void) {
  let cleaned = false;
  const animations = li.getAnimations();
  // Reduced motion leaves nothing to wait for.
  if (animations.length === 0) done();
  else
    void Promise.allSettled(animations.map(({ finished }) => finished)).then(
      () => {
        if (!cleaned) done();
      },
    );
  return () => {
    cleaned = true;
  };
}

const ChatHistoryMessages = ({
  messages,
  replyToId,
  onReply,
}: ChatHistoryMessagesProps) => {
  const [{ messages: followed, shown }, dispatch] = useReducer(
    showing,
    messages,
    (messages): Showing => ({
      messages,
      shown: messages.map((message) => ({ message })),
    }),
  );
  if (messages !== followed) dispatch({ type: "follow", messages });

  return shown.map(({ message, motion }) => {
    const leaving = motion === "leave";
    return (
      <li
        key={message.id}
        data-motion={motion}
        inert={leaving}
        ref={
          leaving
            ? (li: HTMLLIElement) =>
                whenSlidOut(li, () =>
                  dispatch({ type: "slidOut", id: message.id }),
                )
            : undefined
        }
      >
        <ChatMessage {...message} replyToId={replyToId} onReply={onReply} />
        {/* Always mounted, so a first reply slides in and a last one slides out. */}
        <ul>
          <ChatHistoryMessages
            messages={message.replies}
            replyToId={replyToId}
            onReply={onReply}
          />
        </ul>
      </li>
    );
  });
};

export interface ChatHistoryProps {
  messages: Message[];
  replyToId: string | null;
  onReply: (id: string) => void;
}

export const ChatHistory = ({
  messages,
  replyToId,
  onReply,
}: ChatHistoryProps) => {
  const [focusedId, focus] = useReducer(
    (_: string | undefined, id: string | undefined) => id,
    undefined,
  );
  const ids = messageIds(messages);
  // The bottom message, beside the input, until another is focused.
  const tabStop =
    focusedId !== undefined && ids.includes(focusedId) ? focusedId : ids.at(-1);

  // Observed rather than set on render: the reaction picker mounts its buttons from its own state.
  const rovingTabStop = (root: HTMLDivElement) => {
    setTabStop(root, tabStop);
    const observer = new MutationObserver(() => setTabStop(root, tabStop));
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  };

  const trackFocus = (event: FocusEvent<HTMLDivElement>) => {
    focus(event.target.closest<HTMLElement>(".chat-message")?.dataset["id"]);
  };

  const navigate = (event: KeyboardEvent<HTMLDivElement>) =>
    arrowFocus(event, messageElements(event.currentTarget));

  return (
    <div className="chat-history">
      <div
        ref={rovingTabStop}
        className="scrollable"
        role="presentation"
        onFocus={trackFocus}
        onKeyDown={navigate}
      >
        <ul className="content">
          <ChatHistoryMessages
            messages={messages}
            replyToId={replyToId}
            onReply={onReply}
          />
        </ul>
      </div>
    </div>
  );
};
