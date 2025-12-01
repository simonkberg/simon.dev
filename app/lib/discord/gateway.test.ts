// @vitest-environment node

import { ws } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "@/mocks/node";

vi.mock(import("server-only"), () => ({}));

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

const GatewayOpcode = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

function createPayload(
  op: number,
  d: unknown,
  s: number | null = null,
  t: string | null = null,
) {
  return JSON.stringify({ op, d, s, t });
}

describe("subscribe", () => {
  const gateway = ws.link(GATEWAY_URL);

  // Reset module state between tests to get fresh gateway singleton
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    // Make jitter deterministic (0 jitter)
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should complete handshake and resolve", async () => {
    const { subscribe } = await import("./gateway");

    server.use(
      gateway.addEventListener("connection", ({ client }) => {
        client.send(
          createPayload(GatewayOpcode.HELLO, { heartbeat_interval: 45000 }),
        );

        client.addEventListener("message", (event) => {
          const payload = JSON.parse(String(event.data)) as {
            op: number;
            d: unknown;
          };

          if (payload.op === GatewayOpcode.IDENTIFY) {
            client.send(
              createPayload(
                GatewayOpcode.DISPATCH,
                {
                  session_id: "test-session-id",
                  resume_gateway_url: "wss://gateway.discord.gg",
                },
                1,
                "READY",
              ),
            );
          }
        });
      }),
    );

    const callback = vi.fn();
    const unsubscribe = await subscribe(callback);

    expect(unsubscribe).toBeTypeOf("function");
  });

  it("should send heartbeat after interval", async () => {
    const { subscribe } = await import("./gateway");
    const receivedMessages: Array<{ op: number; d: unknown }> = [];

    server.use(
      gateway.addEventListener("connection", ({ client }) => {
        client.send(
          createPayload(GatewayOpcode.HELLO, { heartbeat_interval: 1000 }),
        );

        client.addEventListener("message", (event) => {
          const payload = JSON.parse(String(event.data)) as {
            op: number;
            d: unknown;
          };
          receivedMessages.push(payload);

          if (payload.op === GatewayOpcode.IDENTIFY) {
            client.send(
              createPayload(
                GatewayOpcode.DISPATCH,
                {
                  session_id: "test-session-id",
                  resume_gateway_url: "wss://gateway.discord.gg",
                },
                1,
                "READY",
              ),
            );
          }
        });
      }),
    );

    await subscribe(vi.fn());

    // Clear the IDENTIFY message
    receivedMessages.length = 0;

    // Advance time past the heartbeat interval (with 0 jitter)
    await vi.advanceTimersByTimeAsync(1000);

    expect(receivedMessages).toContainEqual({
      op: GatewayOpcode.HEARTBEAT,
      d: 1, // sequence number from READY event
    });
  });

  it("should continue heartbeating when ACK is received", async () => {
    const { subscribe } = await import("./gateway");
    let heartbeatCount = 0;
    let connectionClosed = false;

    server.use(
      gateway.addEventListener("connection", ({ client }) => {
        client.send(
          createPayload(GatewayOpcode.HELLO, { heartbeat_interval: 1000 }),
        );

        client.addEventListener("message", (event) => {
          const payload = JSON.parse(String(event.data)) as {
            op: number;
            d: unknown;
          };

          if (payload.op === GatewayOpcode.IDENTIFY) {
            client.send(
              createPayload(
                GatewayOpcode.DISPATCH,
                {
                  session_id: "test-session-id",
                  resume_gateway_url: "wss://gateway.discord.gg",
                },
                1,
                "READY",
              ),
            );
          }

          if (payload.op === GatewayOpcode.HEARTBEAT) {
            heartbeatCount++;
            // Respond with ACK
            client.send(createPayload(GatewayOpcode.HEARTBEAT_ACK, null));
          }
        });

        client.addEventListener("close", () => {
          connectionClosed = true;
        });
      }),
    );

    await subscribe(vi.fn());

    // First heartbeat fires immediately (jitter = 0)
    // Then subsequent heartbeats fire every interval
    await vi.advanceTimersByTimeAsync(1000); // Second heartbeat
    await vi.advanceTimersByTimeAsync(1000); // Third heartbeat

    // 1 immediate + 2 interval = 3 total, connection should stay open
    expect(heartbeatCount).toBe(3);
    expect(connectionClosed).toBe(false);
  });

  it("should close connection when no ACK received (zombie detection)", async () => {
    const { subscribe } = await import("./gateway");
    let closeCode: number | undefined;
    let closeReason: string | undefined;

    server.use(
      gateway.addEventListener("connection", ({ client }) => {
        client.send(
          createPayload(GatewayOpcode.HELLO, { heartbeat_interval: 1000 }),
        );

        client.addEventListener("message", (event) => {
          const payload = JSON.parse(String(event.data)) as {
            op: number;
            d: unknown;
          };

          if (payload.op === GatewayOpcode.IDENTIFY) {
            client.send(
              createPayload(
                GatewayOpcode.DISPATCH,
                {
                  session_id: "test-session-id",
                  resume_gateway_url: "wss://gateway.discord.gg",
                },
                1,
                "READY",
              ),
            );
          }
          // Intentionally NOT responding to HEARTBEAT with ACK
        });

        client.addEventListener("close", (event) => {
          closeCode = event.code;
          closeReason = event.reason;
        });
      }),
    );

    await subscribe(vi.fn());

    // First heartbeat fires immediately (jitter = 0), sets awaitingAck = true
    // Second heartbeat at 1000ms sees awaitingAck = true, closes connection
    await vi.advanceTimersByTimeAsync(1000);

    expect(closeCode).toBe(4000);
    expect(closeReason).toBe("Heartbeat timeout");
  });

  it("should respond immediately to server-requested heartbeat", async () => {
    const { subscribe } = await import("./gateway");
    const receivedMessages: Array<{ op: number; d: unknown }> = [];

    server.use(
      gateway.addEventListener("connection", ({ client }) => {
        client.send(
          // Use long interval so scheduled heartbeats don't interfere
          createPayload(GatewayOpcode.HELLO, { heartbeat_interval: 60000 }),
        );

        client.addEventListener("message", (event) => {
          const payload = JSON.parse(String(event.data)) as {
            op: number;
            d: unknown;
          };
          receivedMessages.push(payload);

          if (payload.op === GatewayOpcode.IDENTIFY) {
            client.send(
              createPayload(
                GatewayOpcode.DISPATCH,
                {
                  session_id: "test-session-id",
                  resume_gateway_url: "wss://gateway.discord.gg",
                },
                5, // Use sequence 5 to verify it's included in response
                "READY",
              ),
            );

            // Server requests an immediate heartbeat
            client.send(createPayload(GatewayOpcode.HEARTBEAT, null));
          }
        });
      }),
    );

    await subscribe(vi.fn());

    // Should have IDENTIFY and immediate HEARTBEAT response
    expect(receivedMessages).toHaveLength(2);
    expect(receivedMessages[1]).toEqual({
      op: GatewayOpcode.HEARTBEAT,
      d: 5, // sequence number from READY
    });
  });

  it("should notify subscribers on MESSAGE_CREATE for matching channel", async () => {
    const { subscribe } = await import("./gateway");
    type Client = Parameters<
      Parameters<ReturnType<typeof ws.link>["addEventListener"]>[1]
    >[0]["client"];
    let connectedClient: Client | undefined;

    server.use(
      gateway.addEventListener("connection", ({ client }) => {
        connectedClient = client;

        client.send(
          createPayload(GatewayOpcode.HELLO, { heartbeat_interval: 60000 }),
        );

        client.addEventListener("message", (event) => {
          const payload = JSON.parse(String(event.data)) as {
            op: number;
            d: unknown;
          };

          if (payload.op === GatewayOpcode.IDENTIFY) {
            client.send(
              createPayload(
                GatewayOpcode.DISPATCH,
                {
                  session_id: "test-session-id",
                  resume_gateway_url: "wss://gateway.discord.gg",
                },
                1,
                "READY",
              ),
            );
          }
        });
      }),
    );

    const callback = vi.fn();
    await subscribe(callback);

    expect(callback).not.toHaveBeenCalled();

    // Send MESSAGE_CREATE for matching channel
    connectedClient?.send(
      createPayload(
        GatewayOpcode.DISPATCH,
        { channel_id: "test-discord-channel-id" },
        2,
        "MESSAGE_CREATE",
      ),
    );

    // Allow microtask queue to process the message
    await vi.advanceTimersByTimeAsync(0);

    expect(callback).toHaveBeenCalledTimes(1);
  });
});
