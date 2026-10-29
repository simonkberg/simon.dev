"use client";

import { use, useOptimistic, useReducer, useTransition } from "react";

import {
  type ChatHistoryResult,
  reactToChatMessage,
  type ReactToChatMessageResult,
} from "@/actions/chat";
import ChatMessage, { type ReplyAction } from "@/components/chat/ChatMessage";
import { Subtitle } from "@/components/Subtitle";
import { TooltipButton } from "@/components/Tooltip";
import type { Message, Reaction } from "@/lib/discord/api";
import { withoutSkinTone } from "@/lib/emoji";

import { ChatHistory } from "./ChatHistory";
import { ChatInput } from "./ChatInput";
import { ChatReactionsContext } from "./ChatReactions";
import { ChatTip, useChatTipDismissed } from "./ChatTip";
import { ChatToast } from "./ChatToast";

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

const unreact = (reaction: Reaction): Reaction => ({
  ...reaction,
  count: reaction.count - 1,
  mine: false,
});

function toggleOwnReaction(reactions: Reaction[], emoji: string): Reaction[] {
  const existing = reactions.find((reaction) => reaction.emoji === emoji);
  const adding = !existing?.mine;
  const base = withoutSkinTone(emoji);
  const updated = reactions
    .map((reaction) => {
      if (reaction === existing) {
        return adding
          ? { ...reaction, count: reaction.count + 1, mine: true }
          : unreact(reaction);
      }
      // Adding a tone replaces the visitor's other tones of the emoji, as the server does.
      return adding && reaction.mine && withoutSkinTone(reaction.emoji) === base
        ? unreact(reaction)
        : reaction;
    })
    .filter((reaction) => reaction.count > 0);
  return existing
    ? updated
    : [...updated, { emoji, count: 1, users: [], mine: true }];
}

function withReactionToggled(
  messages: Message[],
  messageId: string,
  emoji: string,
): Message[] {
  // Untouched messages keep their identity, so only the toggled one re-renders.
  return messages.map((message) => {
    if (message.id === messageId) {
      return {
        ...message,
        reactions: toggleOwnReaction(message.reactions, emoji),
      };
    }
    if (!findMessageById(message.replies, messageId)) return message;
    return {
      ...message,
      replies: withReactionToggled(message.replies, messageId, emoji),
    };
  });
}

const replying = (_: string | null, action: ReplyAction) =>
  action.type === "reply" ? action.id : null;

// A fresh object, so the toast shows a repeated error again.
const failure = (
  _: { error: string } | undefined,
  reaction: ReactToChatMessageResult,
) => (reaction.status === "error" ? { error: reaction.error } : undefined);

// Shared, so the passthrough keeps its identity while nothing is pending.
const NOT_REACTING: ReadonlySet<string> = new Set();

export interface ChatProps {
  history: Promise<ChatHistoryResult>;
  tipDismissed: Promise<boolean>;
}

export const Chat = ({ history, tipDismissed }: ChatProps) => {
  const result = use(history);
  const dismissed = useChatTipDismissed(use(tipDismissed));
  const [replyToId, dispatchReply] = useReducer(replying, null);
  const [, startReacting] = useTransition();
  // Per message, so a slow toggle (Discord's rate limit can hold it 30s) blocks only its own.
  const [reacting, markReacting] = useOptimistic(
    NOT_REACTING,
    (ids, messageId: string): ReadonlySet<string> =>
      new Set(ids).add(messageId),
  );
  // Shown at once; the server's history replaces it when the action settles.
  const [messages, toggleOptimistically] = useOptimistic(
    result.status === "ok" ? result.messages : [],
    (current, { messageId, emoji }: { messageId: string; emoji: string }) =>
      withReactionToggled(current, messageId, emoji),
  );
  const [reactionFailure, settleReaction] = useReducer(failure, undefined);

  const react = (messageId: string, emoji: string) => {
    startReacting(async () => {
      markReacting(messageId);
      toggleOptimistically({ messageId, emoji });
      const reaction = await reactToChatMessage(messageId, emoji).catch(
        (): ReactToChatMessageResult => ({
          status: "error",
          error: "Failed to react to chat message",
        }),
      );
      // After an await, updates leave the transition unless wrapped again.
      startReacting(() => settleReaction(reaction));
    });
  };

  if (result.status === "error") {
    return <p>Chat is temporarily unavailable :(</p>;
  }

  // @v8
  const replyToMessage = replyToId
    ? findMessageById(messages, replyToId)
    : null;
  // Its banner holds the only way to clear it.
  if (replyToId && !replyToMessage) dispatchReply({ type: "cancel" });

  return (
    <ChatReactionsContext value={{ reacting, react }}>
      <ChatToast result={reactionFailure} />
      <ChatHistory
        messages={messages}
        replyToId={replyToId}
        dispatchReply={dispatchReply}
      />
      {replyToMessage && (
        <div className="chat-replying-to" role="status" aria-live="polite">
          <Subtitle>Replying to</Subtitle>
          <ChatMessage
            replyToId={replyToId}
            dispatchReply={dispatchReply}
            {...replyToMessage}
            preview
          />
          <TooltipButton
            tooltip="Clear reply"
            className="clear"
            onClick={() => dispatchReply({ type: "cancel" })}
          >
            &times;
          </TooltipButton>
        </div>
      )}
      <ChatInput replyToId={replyToId} dispatchReply={dispatchReply}>
        {!dismissed && <ChatTip />}
      </ChatInput>
    </ChatReactionsContext>
  );
};
