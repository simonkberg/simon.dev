import { connection, type NextRequest, NextResponse } from "next/server";

import { subscribeToChannel } from "@/lib/discord/api";
import { subscribeToStatus } from "@/lib/discord/gateway";
import { log } from "@/lib/log";
import { joinPresence } from "@/lib/presence";
import { findSession } from "@/lib/session";

// Send periodic pings to keep the connection alive and detect client disconnects.
const PING_INTERVAL_MS = 30_000;
const PING_MESSAGE = ": ping\n\n";

const ignoreWriteErrors = (err: unknown) => {
  log.debug({ err }, "SSE write error");
};

export async function GET(request: NextRequest) {
  await connection();
  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  const encoder = new TextEncoder();
  let aborted = false;
  const session = await findSession();
  const send = (text: string) => {
    if (aborted) return;
    void writer.write(encoder.encode(text)).catch(ignoreWriteErrors);
  };

  let unsubscribe: () => void;
  try {
    unsubscribe = await subscribeToChannel(() => send("data: refresh\n\n"));
  } catch (err) {
    log.error({ err }, "Failed to subscribe to gateway");
    return new NextResponse(null, { status: 503 });
  }

  // The client may have left while the gateway was reconnecting, and abort doesn't fire twice.
  if (request.signal.aborted) {
    unsubscribe();
    return new NextResponse(null, { status: 499 });
  }

  // The client counts an open stream as live; this tells it when the gateway
  // behind it drops and comes back.
  const unsubscribeStatus = subscribeToStatus((ready) =>
    send(`event: status\ndata: ${ready ? "live" : "connecting"}\n\n`),
  );

  // The page names its stream when it leaves, so it drops out before the
  // server notices. Sent at once, it also opens the stream on the client.
  const stream = crypto.randomUUID();
  send(`event: stream\ndata: ${stream}\n\n`);
  const leavePresence = joinPresence(stream, session?.username, (here) =>
    send(`event: presence\ndata: ${JSON.stringify(here)}\n\n`),
  );

  const pingInterval = setInterval(() => send(PING_MESSAGE), PING_INTERVAL_MS);

  request.signal.addEventListener("abort", () => {
    aborted = true;
    unsubscribe();
    unsubscribeStatus();
    leavePresence();
    clearInterval(pingInterval);
    void writer.close().catch(ignoreWriteErrors);
  });

  return new NextResponse(responseStream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
