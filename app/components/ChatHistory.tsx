"use client";

import { animated, useTransition } from "@react-spring/web";
import { use, useEffect } from "react";

import { refreshClientCache } from "@/actions/cache";
import type { ChatHistoryResult } from "@/actions/chat";
import type { Message } from "@/lib/discord/api";

import { ChatMessage } from "./ChatMessage";

interface ChatHistoryMessagesProps {
  messages: Message[];
  nested?: boolean;
}

const ChatHistoryMessages = ({
  messages,
  nested = false,
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
          <ChatMessage {...item} />
          {item.replies.length > 0 && (
            <ul>
              <ChatHistoryMessages messages={item.replies} nested />
            </ul>
          )}
        </animated.li>
      ))}
    </>
  );
};

export interface ChatHistoryProps {
  history: Promise<ChatHistoryResult>;
}

export const ChatHistory = ({ history }: ChatHistoryProps) => {
  const result = use(history);

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
      eventSource.onmessage = () => void refreshClientCache();
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

  if (result.status === "error") {
    return <p>Chat is temporarily unavailable :(</p>;
  }

  return (
    <div className="chat-history">
      <div className="scrollable">
        <ul className="content">
          <ChatHistoryMessages messages={result.messages} />
        </ul>
      </div>
    </div>
  );
};
