"use client";

import { animated, useTransition } from "@react-spring/web";
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
import { ChatTyping } from "./ChatTyping";

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
      "a[href], button",
    )) {
      // Not 0: Safari would then tab to these even where it skips every other button and link.
      if (active) control.removeAttribute("tabindex");
      else control.tabIndex = -1;
    }
  }
}

interface ChatHistoryMessagesProps {
  messages: Message[];
  replyToId: string | null;
  setReplyToId: Dispatch<SetStateAction<string | null>>;
  nested?: boolean;
}

const ChatHistoryMessages = ({
  messages,
  nested = false,
  replyToId,
  setReplyToId,
}: ChatHistoryMessagesProps) => {
  const transitions = useTransition(messages, {
    keys: (message) => message.id,
    initial: { opacity: nested ? 1 : 0, x: 0 },
    from: { opacity: 0, x: -100 },
    enter: { opacity: 1, x: 0 },
    leave: { opacity: 0, x: 100 },
  });

  return (
    <>
      {transitions((style, item) => (
        <animated.li
          style={{
            opacity: style.opacity,
            transform: style.x.to((x) => `translateX(${x}%)`),
          }}
        >
          <ChatMessage
            {...item}
            replyToId={replyToId}
            setReplyToId={setReplyToId}
          />
          {/* Always mounted, so a first reply slides in and a last one slides out. */}
          <ul>
            <ChatHistoryMessages
              messages={item.replies}
              replyToId={replyToId}
              setReplyToId={setReplyToId}
              nested
            />
          </ul>
        </animated.li>
      ))}
    </>
  );
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
      <ChatTyping />
    </div>
  );
};
