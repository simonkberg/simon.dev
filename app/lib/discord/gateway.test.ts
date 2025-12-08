// @vitest-environment node

import { type WebSocketLink, ws } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { server } from "@/mocks/node";

vi.mock(import("server-only"), () => ({}));
vi.mock(import("@/lib/log"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    log: {
      ...actual.log,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
});

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

const PayloadSchema = z.preprocess(
  (input, ctx) => {
    if (typeof input === "string") {
      try {
        return JSON.parse(input);
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid JSON string", input });
        return z.NEVER;
      }
    }

    return input;
  },
  z.object({ op: z.number(), d: z.unknown() }),
);

type Payload = z.infer<typeof PayloadSchema>;

const DEFAULT_SESSION = {
  session_id: "test-session-id",
  resume_gateway_url: "wss://gateway.discord.gg",
} as const;

function createPayload(
  op: number,
  d: unknown,
  s: number | null = null,
  t: string | null = null,
) {
  return JSON.stringify({ op, d, s, t });
}

function getLastClient(clients: WebSocketLink["clients"]) {
  return [...clients].at(-1);
}

type Client = ReturnType<typeof getLastClient>;

describe("subscribe", () => {
  const gateway = ws.link(GATEWAY_URL);

  function createHandshakeHandler({
    heartbeatInterval = 60000,
    session = DEFAULT_SESSION,
    sequence = 1,
    onMessage,
    onClose,
  }: {
    heartbeatInterval?: number;
    session?: { session_id: string; resume_gateway_url: string };
    sequence?: number;
    onMessage?: (payload: Payload, client: NonNullable<Client>) => void;
    onClose?: (event: CloseEvent) => void;
  } = {}) {
    return gateway.addEventListener("connection", ({ client }) => {
      client.send(
        createPayload(GatewayOpcode.HELLO, {
          heartbeat_interval: heartbeatInterval,
        }),
      );

      client.addEventListener("message", (event) => {
        const payload = PayloadSchema.parse(event.data);

        if (payload.op === GatewayOpcode.IDENTIFY) {
          client.send(
            createPayload(GatewayOpcode.DISPATCH, session, sequence, "READY"),
          );
        }

        onMessage?.(payload, client);
      });

      if (onClose) {
        client.addEventListener("close", onClose);
      }
    });
  }

  // Reset module state between tests to get fresh gateway singleton
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    // Make jitter deterministic (0 jitter)
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    gateway.clients.forEach((client) => {
      client.close();
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should complete handshake and resolve", async () => {
    const { subscribe } = await import("./gateway");
    server.use(createHandshakeHandler());

    const unsubscribe = await subscribe(vi.fn());

    expect(unsubscribe).toBeTypeOf("function");
  });

  it("should send heartbeat after interval", async () => {
    const { subscribe } = await import("./gateway");
    const receivedMessages: Payload[] = [];

    server.use(
      createHandshakeHandler({
        heartbeatInterval: 1000,
        onMessage: (payload) => receivedMessages.push(payload),
      }),
    );

    await subscribe(vi.fn());

    // Clear the IDENTIFY message
    receivedMessages.length = 0;

    // Advance time past the heartbeat interval (with 0 jitter)
    await vi.advanceTimersByTimeAsync(1000);

    expect(receivedMessages).toMatchObject([
      { op: GatewayOpcode.HEARTBEAT, d: 1 },
    ]);
  });

  it("should continue heartbeating when ACK is received", async () => {
    const { subscribe } = await import("./gateway");
    let heartbeatCount = 0;
    let connectionClosed = false;

    server.use(
      createHandshakeHandler({
        heartbeatInterval: 1000,
        onMessage: (payload, client) => {
          if (payload.op === GatewayOpcode.HEARTBEAT) {
            heartbeatCount++;
            client.send(createPayload(GatewayOpcode.HEARTBEAT_ACK, null));
          }
        },
        onClose: () => {
          connectionClosed = true;
        },
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
      createHandshakeHandler({
        heartbeatInterval: 1000,
        // Intentionally NOT responding to HEARTBEAT with ACK
        onClose: (event) => {
          closeCode = event.code;
          closeReason = event.reason;
        },
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
    const receivedMessages: Payload[] = [];

    server.use(
      gateway.addEventListener("connection", ({ client }) => {
        client.send(
          // Use long interval so scheduled heartbeats don't interfere
          createPayload(GatewayOpcode.HELLO, { heartbeat_interval: 60000 }),
        );

        client.addEventListener("message", (event) => {
          const payload = PayloadSchema.parse(event.data);
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
    server.use(createHandshakeHandler());

    const callback = vi.fn();
    await subscribe(callback);

    expect(callback).not.toHaveBeenCalled();

    // Send MESSAGE_CREATE for matching channel
    getLastClient(gateway.clients)?.send(
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
    server.use(createHandshakeHandler());

    const callback = vi.fn();
    await subscribe(callback);

    // Send MESSAGE_CREATE for a DIFFERENT channel
    getLastClient(gateway.clients)?.send(
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
    server.use(createHandshakeHandler());

    const callback = vi.fn();
    const unsubscribe = await subscribe(callback);
    const client = getLastClient(gateway.clients);

    // First message should trigger callback
    client?.send(
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
    client?.send(
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
    const resumeMessages: Payload[] = [];

    // Initial connection handler
    server.use(
      createHandshakeHandler({
        session: {
          session_id: "test-session-id",
          resume_gateway_url: "wss://resume.discord.gg",
        },
      }),
    );

    // Resume connection handler
    server.use(
      resumeGateway.addEventListener("connection", ({ client }) => {
        client.send(
          createPayload(GatewayOpcode.HELLO, { heartbeat_interval: 60000 }),
        );

        client.addEventListener("message", (event) => {
          const payload = PayloadSchema.parse(event.data);
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
    getLastClient(gateway.clients)?.send(
      createPayload(GatewayOpcode.RECONNECT, null),
    );
    await vi.advanceTimersByTimeAsync(0);

    // Wait for exponential backoff (2^1 * 1000 = 2000ms)
    await vi.advanceTimersByTimeAsync(2000);

    // Should have sent RESUME (not IDENTIFY)
    expect(resumeMessages).toMatchObject([
      {
        op: GatewayOpcode.RESUME,
        d: {
          token: "test-discord-bot-token",
          session_id: "test-session-id",
          seq: 1,
        },
      },
    ]);
  });

  it("should re-identify after non-resumable INVALID_SESSION", async () => {
    const { subscribe } = await import("./gateway");
    let connectionCount = 0;
    const secondConnectionMessages: Payload[] = [];

    server.use(
      gateway.addEventListener("connection", ({ client }) => {
        connectionCount++;

        client.send(
          createPayload(GatewayOpcode.HELLO, { heartbeat_interval: 60000 }),
        );

        client.addEventListener("message", (event) => {
          const payload = PayloadSchema.parse(event.data);

          if (connectionCount === 1) {
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
    const initialClient = getLastClient(gateway.clients);

    // Send INVALID_SESSION with resumable=false
    initialClient?.send(createPayload(GatewayOpcode.INVALID_SESSION, false));
    await vi.advanceTimersByTimeAsync(0);

    // Wait for backoff
    await vi.advanceTimersByTimeAsync(2000);

    // Should have sent IDENTIFY (not RESUME) on second connection
    expect(secondConnectionMessages).toMatchObject([
      { op: GatewayOpcode.IDENTIFY },
    ]);
  });

  it("should not reconnect on fatal close codes", async () => {
    const { subscribe } = await import("./gateway");
    let connectionCount = 0;

    server.use(
      gateway.addEventListener("connection", ({ client }) => {
        connectionCount++;

        client.send(
          createPayload(GatewayOpcode.HELLO, { heartbeat_interval: 60000 }),
        );

        client.addEventListener("message", (event) => {
          const payload = PayloadSchema.parse(event.data);

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
    getLastClient(gateway.clients)?.close(4004, "Authentication failed");
    await vi.advanceTimersByTimeAsync(0);

    // Advance time past any backoff period
    await vi.advanceTimersByTimeAsync(60000);

    // Should only have one connection attempt - no reconnect
    expect(connectionCount).toBe(1);
  });

  it("should re-identify after close with re-identify codes", async () => {
    const { subscribe } = await import("./gateway");
    let connectionCount = 0;
    const secondConnectionMessages: Payload[] = [];

    server.use(
      gateway.addEventListener("connection", ({ client }) => {
        connectionCount++;

        client.send(
          createPayload(GatewayOpcode.HELLO, { heartbeat_interval: 60000 }),
        );

        client.addEventListener("message", (event) => {
          const payload = PayloadSchema.parse(event.data);

          if (connectionCount === 1) {
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
            // Second connection - record messages
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
    const initialClient = getLastClient(gateway.clients);

    // Close with re-identify code 4007 (Invalid seq)
    initialClient?.close(4007, "Invalid seq");
    await vi.advanceTimersByTimeAsync(0);

    // Wait for backoff
    await vi.advanceTimersByTimeAsync(2000);

    // Should have sent IDENTIFY (not RESUME) and used default URL
    expect(secondConnectionMessages).toMatchObject([
      { op: GatewayOpcode.IDENTIFY },
    ]);
    expect(connectionCount).toBe(2);
  });
});
