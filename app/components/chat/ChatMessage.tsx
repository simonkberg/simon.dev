import { type CSSProperties, type Dispatch, Suspense } from "react";

import { RelativeTime } from "@/components/RelativeTime";
import { TooltipButton } from "@/components/Tooltip";
import type { Message } from "@/lib/discord/api";

import { ChatMarkdown } from "./ChatMarkdown";
import { ChatReactionList, ChatReactionPicker } from "./ChatReactions";

export type ReplyAction = { type: "reply"; id: string } | { type: "cancel" };

export interface ChatMessageProps extends Message {
  replyToId: string | null;
  dispatchReply: Dispatch<ReplyAction>;
  /** Shown above the input while replying: just the text, without controls or reactions. */
  preview?: boolean;
}

export const ChatMessage = ({
  id,
  user,
  content,
  edited,
  timestamp,
  reactions,
  replyToId,
  dispatchReply,
  preview = false,
}: ChatMessageProps) => (
  <article
    className="chat-message"
    data-id={id}
    style={{ "--user-color": user.color } as CSSProperties}
  >
    <span className="user">{user.name}: </span>
    <div className="text">
      <ChatMarkdown source={content} />
    </div>
    {edited && <small className="edited"> (edited) </small>}{" "}
    <small className="timestamp">
      <Suspense>
        <RelativeTime date={timestamp} style="narrow" />
      </Suspense>
    </small>{" "}
    {!preview && (
      <>
        <span className="actions">
          <TooltipButton
            tooltip="Reply"
            className="reply"
            onClick={() => dispatchReply({ type: "reply", id })}
            disabled={replyToId === id}
          >
            ↩
          </TooltipButton>
          {reactions.length === 0 && (
            <ChatReactionPicker messageId={id} reactions={reactions} />
          )}
        </span>
        {reactions.length > 0 && (
          <ChatReactionList messageId={id} reactions={reactions} />
        )}
      </>
    )}
  </article>
);

export default ChatMessage;
