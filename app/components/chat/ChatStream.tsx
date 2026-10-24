"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { TooltipText } from "@/components/Tooltip";

import { nameList } from "./ChatReactions";

type Status = "connecting" | "live" | "offline";

const MAX_BACKOFF = 30_000;

// One empty list, so clearing it on every disconnect doesn't re-render.
const NOBODY: readonly string[] = [];

/** Keeps the chat history live over SSE and shows the connection's state, who is here and who is typing. */
export const ChatStream = () => {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("connecting");
  const [here, setHere] = useState<readonly string[]>([]);
  const [typing, setTyping] = useState(NOBODY);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectAttempts = 0;
    let connected = false;
    let gatewayDown = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const disconnect = () => {
      setTyping(NOBODY);
      eventSource?.close();
      eventSource = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const connect = () => {
      disconnect();
      // Every stream after the first missed what changed while none was open.
      const reconnecting = connected;
      connected = true;
      eventSource = new EventSource("/api/chat/sse");
      eventSource.onopen = () => {
        reconnectAttempts = 0;
        setStatus("live");
        if (reconnecting) router.refresh();
        gatewayDown = false;
      };
      eventSource.onmessage = () => router.refresh();
      eventSource.addEventListener("presence", (event) => {
        setHere(JSON.parse(event.data) as string[]);
      });
      eventSource.addEventListener("typing", (event) => {
        setTyping(JSON.parse(event.data) as string[]);
      });
      eventSource.addEventListener("status", (event) => {
        const live = event.data === "live";
        // The store missed changes while the gateway was down.
        if (live && gatewayDown) router.refresh();
        gatewayDown = !live;
        setStatus(live ? "live" : "connecting");
      });
      eventSource.onerror = () => {
        disconnect();
        // Retrying without a network only burns the backoff; `online` resumes.
        if (!navigator.onLine) {
          setStatus("offline");
          return;
        }
        setStatus("connecting");
        reconnectAttempts++;
        const backoff = Math.min(1000 * 2 ** reconnectAttempts, MAX_BACKOFF);
        reconnectTimer = setTimeout(connect, backoff);
      };
    };

    const goOnline = () => {
      reconnectAttempts = 0;
      setStatus("connecting");
      connect();
    };

    const goOffline = () => {
      disconnect();
      setStatus("offline");
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    connect();

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      disconnect();
    };
  }, [router]);

  return (
    <>
      <span className="status" role="status" data-status={status}>
        {status}
      </span>
      {status === "live" && here.length > 0 && (
        <span className="presence">
          <TooltipText tooltip={nameList.format(here)}>
            {here.length} here
          </TooltipText>
        </span>
      )}
      {/* Rendered while empty, so screen readers hear the first typist. */}
      <span className="typing" aria-live="polite">
        {typing.length > 0 && (
          <span className="typists">
            {nameList.format(typing)} {typing.length === 1 ? "is" : "are"}{" "}
            typing…
          </span>
        )}
      </span>
    </>
  );
};
