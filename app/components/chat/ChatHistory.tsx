"use client";

import { animated, useTransition } from "@react-spring/web";
import { type Dispatch, type SetStateAction, useEffect } from "react";

import { refreshChatHistory } from "@/actions/chat";
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
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const MAX_BACKOFF = 30000;

    const connect = () => {
      eventSource = new EventSource("/api/chat/sse");
      eventSource.onopen = () => {
        reconnectAttempts = 0;
      };
      eventSource.onmessage = () => void refreshChatHistory();
      eventSource.onerror = () => {
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        reconnectAttempts++;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        const backoff = Math.min(1000 * 2 ** reconnectAttempts, MAX_BACKOFF);
        reconnectTimer = setTimeout(() => connect(), backoff);
      };
    };

    connect();

    return () => {
      if (eventSource) {
        eventSource.close();
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
    };
  }, []);

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
