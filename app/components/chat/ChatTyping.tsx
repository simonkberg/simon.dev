"use client";

import { BuddyFace } from "./CaretBuddy";
import { nameList } from "./ChatReactions";
import { useTyping } from "./typing";

/** Who is typing, each with their own buddy; the line stays when nobody is, so the chat doesn't jump. */
export const ChatTyping = () => {
  const typing = useTyping();
  return (
    <p className="chat-typing">
      {typing.length > 0 && (
        <>
          {typing.map((name) => (
            <BuddyFace key={name} state="typing" className="face" />
          ))}
          {nameList.format(typing)} {typing.length === 1 ? "is" : "are"} typing…
        </>
      )}
    </p>
  );
};
