"use client";

import type { Ref } from "react";

import type { EmojiMatch } from "@/lib/emoji";

import { ChatSuggestions } from "./ChatSuggestions";
import { EmojiButton } from "./EmojiButton";

export const ChatEmojiSuggestions = ({
  ref,
  id,
  matches,
  active,
  onPick,
  onDismiss,
}: {
  ref: Ref<HTMLDivElement>;
  id: string;
  matches: readonly EmojiMatch[];
  active: number | null;
  onPick: (emoji: string) => void;
  onDismiss: () => void;
}) => {
  const chosen = active === null ? undefined : matches[active];
  return (
    <ChatSuggestions
      ref={ref}
      id={id}
      label="Emoji"
      className="emoji-picker"
      onDismiss={onDismiss}
    >
      {matches.map(({ emoji, name }, index) => (
        <EmojiButton
          key={emoji}
          id={`${id}-${index}`}
          emoji={emoji}
          name={name}
          picker={id}
          type="button"
          role="option"
          aria-selected={index === active}
          tabIndex={-1}
          onClick={() => onPick(emoji)}
        />
      ))}
      <p className="name" aria-hidden="true">
        {chosen && `:${chosen.name}:`}
      </p>
    </ChatSuggestions>
  );
};
