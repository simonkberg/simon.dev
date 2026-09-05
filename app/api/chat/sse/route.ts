import { connection, type NextRequest, NextResponse } from "next/server";

import { subscribe } from "@/lib/discord/gateway";
import { log } from "@/lib/log";

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

  let unsubscribe: () => void;
  try {
    unsubscribe = await subscribe(() => {
      if (aborted) return;
      void writer
        .write(encoder.encode(`data: refresh\n\n`))
        .catch(ignoreWriteErrors);
    });
  } catch (err) {
    log.error({ err }, "Failed to subscribe to gateway");
    return new NextResponse(null, { status: 503 });
  }

  const pingInterval = setInterval(() => {
    if (aborted) return;
    void writer.write(encoder.encode(PING_MESSAGE)).catch(ignoreWriteErrors);
  }, PING_INTERVAL_MS);

  request.signal.addEventListener("abort", () => {
    aborted = true;
    unsubscribe();
    clearInterval(pingInterval);
    void writer.close().catch(ignoreWriteErrors);
  });

  void writer.write(encoder.encode(PING_MESSAGE)).catch(ignoreWriteErrors);

  return new NextResponse(responseStream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
