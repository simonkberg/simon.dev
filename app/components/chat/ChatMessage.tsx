import type { CSSProperties, Dispatch, SetStateAction } from "react";

import { RelativeTime } from "@/components/RelativeTime";
import type { Message } from "@/lib/discord/api";

export interface ChatMessageProps extends Message {
  replyToId: string | null;
  setReplyToId: Dispatch<SetStateAction<string | null>>;
}

export const ChatMessage = ({
  id,
  user,
  content,
  edited,
  timestamp,
  replyToId,
  setReplyToId,
}: ChatMessageProps) => (
  <div
    className="chat-message"
    style={{ "--user-color": user.color } as CSSProperties}
  >
    <span className="user">{user.name}: </span>
    <div className="text" dangerouslySetInnerHTML={{ __html: content }} />
    {edited && <small className="edited"> (edited) </small>}{" "}
    <small className="timestamp">
      <RelativeTime date={timestamp} />
    </small>{" "}
    <button
      aria-label="Reply"
      title="Reply"
      className="reply"
      onClick={() => setReplyToId(id)}
      disabled={replyToId === id}
    >
      ↩
    </button>
  </div>
);

export default ChatMessage;
