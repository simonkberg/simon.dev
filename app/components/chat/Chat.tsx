"use client";

import { use, useState } from "react";

import type { ChatHistoryResult } from "@/actions/chat";
import ChatMessage from "@/components/chat/ChatMessage";
import { Subtitle } from "@/components/Subtitle";
import type { Message } from "@/lib/discord/api";

import { ChatHistory } from "./ChatHistory";
import { ChatInput } from "./ChatInput";

const findMessageById = (messages: Message[], id: string): Message | null => {
  for (const message of messages) {
    if (message.id === id) {
      return message;
    }
    const foundInReplies = findMessageById(message.replies, id);
    if (foundInReplies) {
      return foundInReplies;
    }
  }
  return null;
};

export interface ChatProps {
  history: Promise<ChatHistoryResult>;
}

export const Chat = ({ history }: ChatProps) => {
  const result = use(history);
  const [replyToId, setReplyToId] = useState<string | null>(null);

  if (result.status === "error") {
    return <p>Chat is temporarily unavailable :(</p>;
  }

  const replyToMessage = replyToId
    ? findMessageById(result.messages, replyToId)
    : null;

  return (
    <>
      <ChatHistory
        messages={result.messages}
        replyToId={replyToId}
        setReplyToId={setReplyToId}
      />
      {replyToMessage && (
        <div className="chat-replying-to" role="status" aria-live="polite">
          <Subtitle>Replying to</Subtitle>
          <ChatMessage
            replyToId={replyToId}
            setReplyToId={setReplyToId}
            {...replyToMessage}
          />
          <button
            aria-label="Clear reply"
            title="Clear reply"
            className="clear"
            onClick={() => setReplyToId(null)}
          >
            &times;
          </button>
        </div>
      )}
      <ChatInput replyToId={replyToId} setReplyToId={setReplyToId} />
    </>
  );
};
