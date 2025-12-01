import type { CSSProperties } from "react";

import type { Message } from "@/lib/discord/api";

export const ChatMessage = ({ user, content, edited }: Message) => (
  <div
    className="chat-message"
    style={{ "--user-color": user.color } as CSSProperties}
  >
    <span className="user">{user.name}: </span>
    <div className="text" dangerouslySetInnerHTML={{ __html: content }} />
    {edited && <small className="edited"> (edited) </small>}
  </div>
);

export default ChatMessage;
