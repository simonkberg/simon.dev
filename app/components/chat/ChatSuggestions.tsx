"use client";

import type { ReactNode, Ref, ToggleEvent } from "react";

export interface SuggestionProps {
  id: string;
  type: "button";
  role: "option";
  "aria-selected": boolean;
  tabIndex: -1;
}

/** The popover listbox of what the chat input suggests, one option per match. */
export const ChatSuggestions = <T,>({
  ref,
  id,
  label,
  className,
  matches,
  active,
  option,
  onDismiss,
  children,
}: {
  ref: Ref<HTMLDivElement>;
  id: string;
  label: string;
  className: string;
  matches: readonly T[];
  active: number | null;
  option: (match: T, props: SuggestionProps) => ReactNode;
  onDismiss: () => void;
  children?: ReactNode;
}) => (
  <div
    ref={ref}
    id={id}
    popover="auto"
    role="listbox"
    aria-label={label}
    tabIndex={-1}
    className={className}
    // Keeps focus in the input, so typing carries on filtering.
    onMouseDown={(event) => event.preventDefault()}
    onToggle={(event: ToggleEvent<HTMLDivElement>) => {
      if (event.newState === "closed") onDismiss();
    }}
  >
    {matches.map((match, index) =>
      option(match, {
        id: `${id}-${index}`,
        type: "button",
        role: "option",
        "aria-selected": index === active,
        tabIndex: -1,
      }),
    )}
    {children}
  </div>
);
