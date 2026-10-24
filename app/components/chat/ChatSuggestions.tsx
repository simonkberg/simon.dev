"use client";

import type { PropsWithChildren, Ref, ToggleEvent } from "react";

/** The popover listbox of what the chat input suggests. */
export const ChatSuggestions = ({
  ref,
  id,
  label,
  className,
  onDismiss,
  children,
}: PropsWithChildren<{
  ref: Ref<HTMLDivElement>;
  id: string;
  label: string;
  className: string;
  onDismiss: () => void;
}>) => (
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
    {children}
  </div>
);
