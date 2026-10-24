"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { TooltipText } from "@/components/Tooltip";

type Status = "connecting" | "live" | "offline";

const MAX_BACKOFF = 30_000;

/** Keeps the chat history live over SSE and shows the connection's state and who is here. */
export const ChatStream = () => {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("connecting");
  const [here, setHere] = useState<readonly string[]>([]);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectAttempts = 0;
    let connected = false;
    let gatewayDown = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stream: string | null = null;

    const disconnect = () => {
      eventSource?.close();
      eventSource = null;
      // The server only notices a closed stream at its next ping.
      if (stream) navigator.sendBeacon("/api/chat/presence", stream);
      stream = null;
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
      eventSource.addEventListener("stream", (event) => {
        stream = event.data;
      });
      eventSource.addEventListener("presence", (event) => {
        setHere(JSON.parse(event.data) as string[]);
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

    // Closing or leaving the page runs no cleanup, and a page kept in the
    // back/forward cache comes back without its stream.
    const resume = (event: PageTransitionEvent) => {
      if (event.persisted) goOnline();
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener("pagehide", disconnect);
    window.addEventListener("pageshow", resume);
    connect();

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("pagehide", disconnect);
      window.removeEventListener("pageshow", resume);
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
          <TooltipText tooltip={here.join(", ")}>
            {here.length} here
          </TooltipText>
        </span>
      )}
    </>
  );
};
