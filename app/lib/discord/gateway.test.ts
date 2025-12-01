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

  it("should ignore messages from other channels", async () => {
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

    // Send MESSAGE_CREATE for a DIFFERENT channel
    connectedClient?.send(
      createPayload(
        GatewayOpcode.DISPATCH,
        { channel_id: "some-other-channel-id" },
        2,
        "MESSAGE_CREATE",
      ),
    );

    await vi.advanceTimersByTimeAsync(0);

    expect(callback).not.toHaveBeenCalled();
  });

  it("should stop notifying after unsubscribe", async () => {
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
    const unsubscribe = await subscribe(callback);

    // First message should trigger callback
    connectedClient?.send(
      createPayload(
        GatewayOpcode.DISPATCH,
        { channel_id: "test-discord-channel-id" },
        2,
        "MESSAGE_CREATE",
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenCalledTimes(1);

    // Unsubscribe
    unsubscribe();

    // Second message should NOT trigger callback
    connectedClient?.send(
      createPayload(
        GatewayOpcode.DISPATCH,
        { channel_id: "test-discord-channel-id" },
        3,
        "MESSAGE_CREATE",
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenCalledTimes(1); // Still 1, not 2
  });

  it("should send RESUME instead of IDENTIFY on reconnect", async () => {
    const { subscribe } = await import("./gateway");
    const RESUME_URL = "wss://resume.discord.gg/?v=10&encoding=json";
    const resumeGateway = ws.link(RESUME_URL);

    type Client = Parameters<
      Parameters<ReturnType<typeof ws.link>["addEventListener"]>[1]
    >[0]["client"];
    let initialClient: Client | undefined;
    const resumeMessages: Array<{ op: number; d: unknown }> = [];

    // Initial connection handler
    server.use(
      gateway.addEventListener("connection", ({ client }) => {
        initialClient = client;

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
                  // Different URL for resume
                  resume_gateway_url: "wss://resume.discord.gg",
                },
                1,
                "READY",
              ),
            );
          }
        });
      }),
    );

    // Resume connection handler
    server.use(
      resumeGateway.addEventListener("connection", ({ client }) => {
        client.send(
          createPayload(GatewayOpcode.HELLO, { heartbeat_interval: 60000 }),
        );

        client.addEventListener("message", (event) => {
          const payload = JSON.parse(String(event.data)) as {
            op: number;
            d: unknown;
          };
          resumeMessages.push(payload);

          if (payload.op === GatewayOpcode.RESUME) {
            client.send(
              createPayload(GatewayOpcode.DISPATCH, null, 1, "RESUMED"),
            );
          }
        });
      }),
    );

    await subscribe(vi.fn());

    // Trigger reconnect via RECONNECT opcode
    initialClient?.send(createPayload(GatewayOpcode.RECONNECT, null));
    await vi.advanceTimersByTimeAsync(0);

    // Wait for exponential backoff (2^1 * 1000 = 2000ms)
    await vi.advanceTimersByTimeAsync(2000);

    // Should have sent RESUME, not IDENTIFY
    expect(resumeMessages).toContainEqual({
      op: GatewayOpcode.RESUME,
      d: {
        token: "test-discord-bot-token",
        session_id: "test-session-id",
        seq: 1,
      },
    });
    expect(resumeMessages).not.toContainEqual(
      expect.objectContaining({ op: GatewayOpcode.IDENTIFY }),
    );
  });

  it("should re-identify after non-resumable INVALID_SESSION", async () => {
    const { subscribe } = await import("./gateway");

    type Client = Parameters<
      Parameters<ReturnType<typeof ws.link>["addEventListener"]>[1]
    >[0]["client"];
    let initialClient: Client | undefined;
    let connectionCount = 0;
    const secondConnectionMessages: Array<{ op: number; d: unknown }> = [];

    server.use(
      gateway.addEventListener("connection", ({ client }) => {
        connectionCount++;

        client.send(
          createPayload(GatewayOpcode.HELLO, { heartbeat_interval: 60000 }),
        );

        client.addEventListener("message", (event) => {
          const payload = JSON.parse(String(event.data)) as {
            op: number;
            d: unknown;
          };

          if (connectionCount === 1) {
            initialClient = client;
            if (payload.op === GatewayOpcode.IDENTIFY) {
              client.send(
                createPayload(
                  GatewayOpcode.DISPATCH,
                  {
                    session_id: "test-session-id",
                    resume_gateway_url: "wss://resume.discord.gg",
                  },
                  1,
                  "READY",
                ),
              );
            }
          } else {
            // Second connection - record messages to verify IDENTIFY
            secondConnectionMessages.push(payload);
            if (payload.op === GatewayOpcode.IDENTIFY) {
              client.send(
                createPayload(
                  GatewayOpcode.DISPATCH,
                  {
                    session_id: "new-session-id",
                    resume_gateway_url: "wss://gateway.discord.gg",
                  },
                  1,
                  "READY",
                ),
              );
            }
          }
        });
      }),
    );

    await subscribe(vi.fn());

    // Send INVALID_SESSION with resumable=false
    initialClient?.send(createPayload(GatewayOpcode.INVALID_SESSION, false));
    await vi.advanceTimersByTimeAsync(0);

    // Wait for backoff
    await vi.advanceTimersByTimeAsync(2000);

    // Should have sent IDENTIFY (not RESUME) on second connection
    expect(secondConnectionMessages).toContainEqual(
      expect.objectContaining({ op: GatewayOpcode.IDENTIFY }),
    );
    expect(secondConnectionMessages).not.toContainEqual(
      expect.objectContaining({ op: GatewayOpcode.RESUME }),
    );
  });

  it("should not reconnect on fatal close codes", async () => {
    const { subscribe } = await import("./gateway");
    type Client = Parameters<
      Parameters<ReturnType<typeof ws.link>["addEventListener"]>[1]
    >[0]["client"];
    let connectedClient: Client | undefined;
    let connectionCount = 0;

    server.use(
      gateway.addEventListener("connection", ({ client }) => {
        connectionCount++;
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

    await subscribe(vi.fn());

    // Close with fatal code after handshake is complete
    connectedClient?.close(4004, "Authentication failed");
    await vi.advanceTimersByTimeAsync(0);

    // Advance time past any backoff period
    await vi.advanceTimersByTimeAsync(60000);

    // Should only have one connection attempt - no reconnect
    expect(connectionCount).toBe(1);
  });
});
