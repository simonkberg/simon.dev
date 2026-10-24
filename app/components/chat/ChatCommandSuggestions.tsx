"use client";

import type { Ref } from "react";

import { ChatSuggestions } from "./ChatSuggestions";
import type { CommandSuggestion } from "./commands";

export const ChatCommandSuggestions = ({
  ref,
  id,
  matches,
  active,
  onPick,
  onDismiss,
}: {
  ref: Ref<HTMLDivElement>;
  id: string;
  matches: readonly CommandSuggestion[];
  active: number | null;
  onPick: (value: string) => void;
  onDismiss: () => void;
}) => (
  <ChatSuggestions
    ref={ref}
    id={id}
    label="Commands"
    className="command-picker"
    onDismiss={onDismiss}
  >
    {matches.map(({ value, label, detail }, index) => (
      <button
        key={value}
        id={`${id}-${index}`}
        type="button"
        role="option"
        aria-selected={index === active}
        tabIndex={-1}
        onClick={() => onPick(value)}
      >
        <span className="label">{label}</span>
        {detail && <span className="detail">{detail}</span>}
      </button>
    ))}
  </ChatSuggestions>
);
