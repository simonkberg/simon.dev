"use client";

import { type ReactNode, useReducer } from "react";

/** Discord's `||spoiler||`: hidden until clicked, then shown for good. */
export const ChatSpoiler = ({ children }: { children: ReactNode }) => {
  const [spoiler, reveal] = useReducer(
    (): "hidden" | "revealed" => "revealed",
    "hidden",
  );

  // The same spans either way, so revealing never remounts what's inside.
  // A `<button>` can't hold the links a spoiler may, nor wrap across lines like text.
  return spoiler === "hidden" ? (
    <span
      className="spoiler"
      role="button"
      tabIndex={0}
      aria-label="Spoiler"
      onClick={(event) => {
        // In a link's text, the first click only reveals.
        event.preventDefault();
        reveal();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        reveal();
      }}
    >
      <span inert>{children}</span>
    </span>
  ) : (
    // Focusable still, so revealing by keyboard keeps focus where it was.
    <span className="spoiler" tabIndex={-1}>
      <span>{children}</span>
    </span>
  );
};
