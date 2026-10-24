"use client";

import { useBuddyFace } from "./CaretBuddy";
import { nameList } from "./ChatReactions";
import { useTyping } from "./typing";

/** Who is typing, each with their own buddy; the line stays when nobody is, so the chat doesn't jump. */
export const ChatTyping = () => {
  const typing = useTyping();
  const face = useBuddyFace("typing");
  return (
    <p className="chat-typing" aria-live="polite">
      {typing.length > 0 && (
        <>
          {typing.map((name) => (
            <span key={name} className="face" aria-hidden="true">
              {face}
            </span>
          ))}
          {nameList.format(typing)} {typing.length === 1 ? "is" : "are"} typing…
        </>
      )}
    </p>
  );
};
