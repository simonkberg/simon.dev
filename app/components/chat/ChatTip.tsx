"use client";

import { useTransition } from "react";

import { dismissChatTip } from "@/actions/chat";

export const ChatTip = () => {
  const [pending, startTransition] = useTransition();

  return (
    <p className="tip">
      Tip: mention &ldquo;simon bot&rdquo; to chat with a clanker.{" "}
      <button
        // Without this it submits the chat form it sits inside.
        type="button"
        aria-label="Dismiss tip"
        title="Dismiss tip"
        className="clear"
        disabled={pending}
        onClick={() => startTransition(dismissChatTip)}
      >
        &times;
      </button>
    </p>
  );
};
