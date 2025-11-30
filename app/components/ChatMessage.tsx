import SimpleMarkdown from "@khanacademy/simple-markdown";
import type { CSSProperties } from "react";

import type { Message } from "@/lib/discord";

export const ChatMessage = ({ user, content, edited }: Message) => {
  "no compile";

  return (
    <div
      className="chat-message"
      style={{ "--user-color": user.color } as CSSProperties}
    >
      <span className="user">{user.name}: </span>
      <div
        className="text"
        dangerouslySetInnerHTML={{
          __html: SimpleMarkdown.defaultHtmlOutput(
            SimpleMarkdown.defaultInlineParse(content),
          ),
        }}
      />
      {edited && <small className="edited"> (edited) </small>}
    </div>
  );
};

export default ChatMessage;
