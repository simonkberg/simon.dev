"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer } from "react";

import { TooltipText } from "@/components/Tooltip";

import { nameList } from "./ChatReactions";

const MAX_BACKOFF = 30_000;

// Who is here and typing arrive only on an open stream, and leave with it.
type Stream =
  | { status: "connecting" | "offline" }
  | {
      status: "open";
      gateway: "live" | "connecting";
      here: readonly string[];
      typing: readonly string[];
    };

type StreamAction =
  | { type: "connect" | "offline" | "open" }
  | { type: "gateway"; live: boolean }
  | { type: "presence" | "typing"; names: readonly string[] };

// Shared, so a retry while already connecting doesn't re-render.
const CONNECTING: Stream = { status: "connecting" };
const OFFLINE: Stream = { status: "offline" };
const NOBODY: readonly string[] = [];

function stream(state: Stream, action: StreamAction): Stream {
  switch (action.type) {
    case "connect":
      return CONNECTING;
    case "offline":
      return OFFLINE;
    case "open":
      return { status: "open", gateway: "live", here: NOBODY, typing: NOBODY };
  }
  if (state.status !== "open") return state;
  switch (action.type) {
    case "gateway": {
      const gateway = action.live ? "live" : "connecting";
      return gateway === state.gateway ? state : { ...state, gateway };
    }
    case "presence":
      return { ...state, here: action.names };
    case "typing":
      return { ...state, typing: action.names };
  }
}

/** Keeps the chat history live over SSE and shows the connection's state, who is here and who is typing. */
export const ChatStream = () => {
  const router = useRouter();
  const [state, dispatch] = useReducer(stream, CONNECTING);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectAttempts = 0;
    let connected = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const disconnect = () => {
      eventSource?.close();
      eventSource = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const connect = () => {
      disconnect();
      dispatch({ type: "connect" });
      // Every stream after the first missed what changed while none was open.
      const reconnecting = connected;
      connected = true;
      eventSource = new EventSource("/api/chat/sse");
      eventSource.onopen = () => {
        reconnectAttempts = 0;
        dispatch({ type: "open" });
        if (reconnecting) router.refresh();
      };
      eventSource.onmessage = () => router.refresh();
      eventSource.addEventListener("presence", (event) => {
        dispatch({
          type: "presence",
          names: JSON.parse(event.data) as string[],
        });
      });
      eventSource.addEventListener("typing", (event) => {
        dispatch({ type: "typing", names: JSON.parse(event.data) as string[] });
      });
      eventSource.addEventListener("status", (event) => {
        // No refresh on recovery: the store notifies once it has caught up.
        dispatch({ type: "gateway", live: event.data === "live" });
      });
      eventSource.onerror = () => {
        disconnect();
        // Retrying without a network only burns the backoff; `online` resumes.
        if (!navigator.onLine) {
          dispatch({ type: "offline" });
          return;
        }
        dispatch({ type: "connect" });
        reconnectAttempts++;
        const backoff = Math.min(1000 * 2 ** reconnectAttempts, MAX_BACKOFF);
        reconnectTimer = setTimeout(connect, backoff);
      };
    };

    const goOnline = () => {
      reconnectAttempts = 0;
      connect();
    };

    const goOffline = () => {
      disconnect();
      dispatch({ type: "offline" });
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

  const status = state.status === "open" ? state.gateway : state.status;
  const here = state.status === "open" ? state.here : NOBODY;
  const typing = state.status === "open" ? state.typing : NOBODY;

  return (
    <>
      <span className="status" role="status" data-status={status}>
        {status}
      </span>
      {status === "live" && here.length > 0 && (
        <span className="presence">
          {/* simon-bot is always here, but counts as no one. */}
          <TooltipText tooltip={nameList.format([...here, "simon-bot"])}>
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
