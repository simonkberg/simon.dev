"use client";

import { animated, useTransition } from "@react-spring/web";
import type { Dispatch, SetStateAction } from "react";

import type { Message } from "@/lib/discord/api";

import { ChatMessage } from "./ChatMessage";

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
          {item.replies.length > 0 && (
            <ul>
              <ChatHistoryMessages
                messages={item.replies}
                replyToId={replyToId}
                setReplyToId={setReplyToId}
                nested
              />
            </ul>
          )}
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
  return (
    <div className="chat-history">
      <div className="scrollable">
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
