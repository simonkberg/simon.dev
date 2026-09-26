"use client";

import { useEffect, useState } from "react";

import { refreshChatHistory } from "@/actions/chat";

type Status = "connecting" | "live" | "offline";

const MAX_BACKOFF = 30_000;

/** Keeps the chat history live over SSE and shows the connection's state. */
export const ChatStream = () => {
  const [status, setStatus] = useState<Status>("connecting");

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const disconnect = () => {
      eventSource?.close();
      eventSource = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const connect = () => {
      disconnect();
      eventSource = new EventSource("/api/chat/sse");
      eventSource.onopen = () => {
        reconnectAttempts = 0;
        setStatus("live");
      };
      eventSource.onmessage = () => void refreshChatHistory();
      eventSource.addEventListener("status", (event) => {
        setStatus(event.data === "live" ? "live" : "connecting");
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
  }, []);

  return (
    <span className="status" role="status" data-status={status}>
      {status}
    </span>
  );
};
