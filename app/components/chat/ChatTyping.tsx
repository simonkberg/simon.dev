"use client";

import { useBuddyFace } from "./CaretBuddy";
import { nameList } from "./ChatReactions";
import { useTyping } from "./typing";

/** Who is typing, each with their own buddy, floating over the history's foot so it takes no room. */
export const ChatTyping = () => {
  const typing = useTyping();
  return (
    <p className="chat-typing" aria-live="polite">
      {typing.length > 0 && <Typists typing={typing} />}
    </p>
  );
};

// Its own component, so the face animates only while someone is typing.
const Typists = ({ typing }: { typing: readonly string[] }) => {
  const face = useBuddyFace("typing");
  return (
    <>
      {typing.map((name) => (
        <span key={name} className="face" aria-hidden="true">
          {face}
        </span>
      ))}
      {nameList.format(typing)} {typing.length === 1 ? "is" : "are"} typing…
    </>
  );
};
