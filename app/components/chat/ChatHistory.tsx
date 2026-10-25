"use client";

import {
  type Dispatch,
  type FocusEvent,
  type KeyboardEvent,
  type SetStateAction,
  useState,
} from "react";

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
  setReplyToId: Dispatch<SetStateAction<string | null>>;
  nested?: boolean;
}

interface Shown {
  message: Message;
  motion?: "appear" | "enter" | "leave";
}

// Keeps each removed message where it was, sliding out, until its animation ends.
function follow(shown: readonly Shown[], messages: readonly Message[]) {
  const motions = new Map(
    shown.map(({ message, motion }) => [message.id, motion]),
  );
  const next = messages.map((message): Shown => {
    const motion = motions.has(message.id) ? motions.get(message.id) : "enter";
    return { message, motion: motion === "leave" ? "enter" : motion };
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

const ChatHistoryMessages = ({
  messages,
  nested = false,
  replyToId,
  setReplyToId,
}: ChatHistoryMessagesProps) => {
  const [shown, setShown] = useState(() =>
    messages.map((message): Shown => ({
      message,
      motion: nested ? undefined : "appear",
    })),
  );
  const [followed, setFollowed] = useState(messages);
  if (messages !== followed) {
    setFollowed(messages);
    setShown(follow(shown, messages));
  }

  const remove = (id: string) =>
    setShown((current) =>
      current.filter(
        ({ message, motion }) => message.id !== id || motion !== "leave",
      ),
    );

  return shown.map(({ message, motion }) => {
    const leaving = motion === "leave";
    return (
      <li
        key={message.id}
        data-motion={motion}
        inert={leaving}
        ref={
          leaving
            ? (li: HTMLLIElement | null) => {
                if (!li) return;
                const done = () => remove(message.id);
                const animations = li.getAnimations();
                // Reduced motion leaves nothing to wait for.
                if (animations.length === 0) done();
                // Settles once the slide ends or is cancelled.
                else
                  void Promise.allSettled(
                    animations.map(({ finished }) => finished),
                  ).then(done);
              }
            : undefined
        }
      >
        <ChatMessage
          {...message}
          replyToId={replyToId}
          setReplyToId={setReplyToId}
        />
        {/* Always mounted, so a first reply slides in and a last one slides out. */}
        <ul>
          <ChatHistoryMessages
            messages={message.replies}
            replyToId={replyToId}
            setReplyToId={setReplyToId}
            nested
          />
        </ul>
      </li>
    );
  });
};

export interface ChatHistoryProps {
  messages: Message[];
  replyToId: string | null;
  setReplyToId: Dispatch<SetStateAction<string | null>>;
}

export const ChatHistory = ({
  messages,
  replyToId,
  setReplyToId,
}: ChatHistoryProps) => {
  const [focusedId, setFocusedId] = useState<string>();
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
    setFocusedId(
      event.target.closest<HTMLElement>(".chat-message")?.dataset["id"],
    );
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
            setReplyToId={setReplyToId}
          />
        </ul>
      </div>
    </div>
  );
};
