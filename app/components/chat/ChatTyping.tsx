"use client";

import { useBuddyFace } from "./CaretBuddy";
import { nameList } from "./ChatReactions";

/** Who is typing, each with their own buddy. */
export const ChatTyping = ({ typing }: { typing: readonly string[] }) => (
  // Rendered while empty, so screen readers hear the first typist.
  <span className="typing" aria-live="polite">
    {typing.length > 0 && <Typists typing={typing} />}
  </span>
);

// Its own component, so the face animates only while someone is typing.
const Typists = ({ typing }: { typing: readonly string[] }) => {
  const face = useBuddyFace("typing");
  return (
    <span className="typists">
      {typing.map((name) => (
        <span key={name} className="face" aria-hidden="true">
          {face}
        </span>
      ))}
      {nameList.format(typing)} {typing.length === 1 ? "is" : "are"} typing…
    </span>
  );
};
