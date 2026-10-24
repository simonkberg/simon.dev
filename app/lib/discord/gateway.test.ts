// @vitest-environment node

import { type WebSocketLink, ws } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { log } from "@/lib/log";
import { message } from "@/mocks/discord";
import { mockEnv } from "@/mocks/env";
import { server } from "@/mocks/node";

import { connect, getBotUserId, subscribe, subscribeToStatus } from "./gateway";

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const RESUME_URL = "wss://resume.discord.gg/?v=10&encoding=json";
const CHANNEL = mockEnv.DISCORD_CHANNEL_ID;

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
  user: { id: "bot-user-id" },
  session_id: "test-session-id",
  resume_gateway_url: "wss://gateway.discord.gg",
} as const;

const RESUME_SESSION = {
  ...DEFAULT_SESSION,
  resume_gateway_url: "wss://resume.discord.gg",
};

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

type Client = NonNullable<ReturnType<typeof getLastClient>>;

describe("subscribe", () => {
  const gateway = ws.link(GATEWAY_URL);
  const resumeGateway = ws.link(RESUME_URL);
  let connections: number;

  function createHandshakeHandler({
    link = gateway,
    heartbeatInterval = 60000,
    session = DEFAULT_SESSION,
    sequence = 1,
    dropFirst = false,
    onMessage,
    onClose,
  }: {
    link?: WebSocketLink;
    heartbeatInterval?: number;
    session?: unknown;
    sequence?: number;
    dropFirst?: boolean;
    onMessage?: (payload: Payload, client: Client) => void;
    onClose?: (event: CloseEvent) => void;
  } = {}) {
    return link.addEventListener("connection", ({ client }) => {
      if (connections++ === 0 && dropFirst) {
        client.close(4000, "Dropped");
        return;
      }
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
        } else if (payload.op === GatewayOpcode.RESUME) {
          client.send(
            createPayload(GatewayOpcode.DISPATCH, null, sequence, "RESUMED"),
          );
        }

        onMessage?.(payload, client);
      });

      if (onClose) {
        client.addEventListener("close", onClose);
      }
    });
  }

  // What the bot sends to the resume gateway, which answers like the main one.
  function recordResumes() {
    const messages: Payload[] = [];
    server.use(
      createHandshakeHandler({
        link: resumeGateway,
        onMessage: (payload) => messages.push(payload),
      }),
    );
    return messages;
  }

  async function subscribed() {
    server.use(createHandshakeHandler());
    const callback = vi.fn();
    const unsubscribe = await subscribe(callback);
    callback.mockClear();
    return { callback, unsubscribe };
  }

  async function dispatch(event: string, data: unknown) {
    getLastClient(gateway.clients)?.send(
      createPayload(GatewayOpcode.DISPATCH, data, 2, event),
    );
    await vi.advanceTimersByTimeAsync(0);
  }

  beforeEach(() => {
    connections = 0;
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    for (const client of [...gateway.clients, ...resumeGateway.clients]) {
      client.close();
    }
  });

  it("should heartbeat at the interval with the last sequence while ACKs arrive", async () => {
    const heartbeats: Payload[] = [];
    let connectionClosed = false;

    server.use(
      createHandshakeHandler({
        heartbeatInterval: 1000,
        onMessage: (payload, client) => {
          if (payload.op === GatewayOpcode.HEARTBEAT) {
            heartbeats.push(payload);
            client.send(createPayload(GatewayOpcode.HEARTBEAT_ACK, null));
          }
        },
        onClose: () => {
          connectionClosed = true;
        },
      }),
    );

    await subscribe(vi.fn());
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(heartbeats).toEqual(
      Array(3).fill({ op: GatewayOpcode.HEARTBEAT, d: 1 }),
    );
    expect(connectionClosed).toBe(false);
  });

  it("should close connection when no ACK received (zombie detection)", async () => {
    let closeCode: number | undefined;
    let closeReason: string | undefined;

    server.use(
      createHandshakeHandler({
        heartbeatInterval: 1000,
        onClose: (event) => {
          closeCode = event.code;
          closeReason = event.reason;
        },
      }),
    );

    await subscribe(vi.fn());

    // The first heartbeat goes out at once (no jitter), so the one at 1000ms finds it unanswered.
    await vi.advanceTimersByTimeAsync(1000);

    expect(closeCode).toBe(4000);
    expect(closeReason).toBe("Heartbeat timeout");
  });

  it("should respond immediately to server-requested heartbeat", async () => {
    const receivedMessages: Payload[] = [];

    server.use(
      createHandshakeHandler({
        sequence: 5,
        onMessage: (payload, client) => {
          receivedMessages.push(payload);
          if (payload.op === GatewayOpcode.IDENTIFY) {
            client.send(createPayload(GatewayOpcode.HEARTBEAT, null));
          }
        },
      }),
    );

    await subscribe(vi.fn());

    expect(receivedMessages).toEqual([
      expect.objectContaining({ op: GatewayOpcode.IDENTIFY }),
      { op: GatewayOpcode.HEARTBEAT, d: 5 },
    ]);
  });

  it("should ignore messages from other channels", async () => {
    const { callback } = await subscribed();

    await dispatch("MESSAGE_CREATE", {
      ...message("msg-1"),
      channel_id: "some-other-channel-id",
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it("should log a throwing subscriber and still notify the rest", async () => {
    server.use(createHandshakeHandler());
    await subscribe(() => {
      throw new Error("Subscriber failed");
    });
    const callback = vi.fn();
    await subscribe(callback);

    await dispatch("MESSAGE_CREATE", message("msg-1", { content: "first" }));

    expect(log.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Subscriber callback error",
    );
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ t: "MESSAGE_CREATE" }),
    );
  });

  it("should stop notifying after unsubscribe", async () => {
    const { callback, unsubscribe } = await subscribed();

    await dispatch("MESSAGE_CREATE", message("msg-1", { content: "first" }));
    expect(callback).toHaveBeenCalledOnce();

    unsubscribe();
    await dispatch("MESSAGE_CREATE", message("msg-2", { content: "second" }));
    expect(callback).toHaveBeenCalledOnce();
  });

  it("should notify subscribers of a new session", async () => {
    server.use(createHandshakeHandler());

    expect(getBotUserId()).toBeNull();

    const callback = vi.fn();
    const unsubscribe = await subscribe(callback);

    expect(unsubscribe).toBeTypeOf("function");
    expect(callback).toHaveBeenCalledExactlyOnceWith({ t: "READY" });
    expect(getBotUserId()).toBe("bot-user-id");
  });

  it("should connect without a subscriber", async () => {
    server.use(createHandshakeHandler());

    await connect();

    expect(gateway.clients.size).toBe(1);
  });

  it("should share one connection between concurrent subscribers", async () => {
    server.use(createHandshakeHandler());

    await Promise.all([subscribe(vi.fn()), subscribe(vi.fn())]);

    expect(gateway.clients.size).toBe(1);
  });

  it("should share one gateway across module instances", async () => {
    server.use(createHandshakeHandler());
    await subscribe(vi.fn());

    // A fresh module graph, as Next gives instrumentation and each route, must find the same gateway.
    vi.resetModules();
    const second = await import("./gateway");
    await second.subscribe(vi.fn());

    expect(gateway.clients.size).toBe(1);
  });

  it("should resolve after a reconnect when the socket drops before READY", async () => {
    server.use(createHandshakeHandler({ dropFirst: true }));

    const subscribed = subscribe(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(connections).toBe(1);

    await vi.advanceTimersByTimeAsync(2000);

    await expect(subscribed).resolves.toBeTypeOf("function");
    expect(connections).toBe(2);
  });

  it("should reject when the socket closes with a fatal code before READY", async () => {
    server.use(
      gateway.addEventListener("connection", ({ client }) => {
        client.close(4004, "Authentication failed");
      }),
    );

    await expect(subscribe(vi.fn())).rejects.toThrow(
      "Gateway closed with fatal code 4004: Authentication failed",
    );
  });

  it("should log WebSocket errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    // msw surfaces a throwing connection handler as an error event on the client
    server.use(
      gateway.addEventListener("connection", () => {
        throw new Error("Connection failed");
      }),
    );

    void subscribe(vi.fn());
    await vi.advanceTimersByTimeAsync(0);

    expect(log.error).toHaveBeenCalledWith(
      { error: expect.any(Event) },
      "Gateway WebSocket error",
    );
  });

  it("should keep waiting for READY after an unparseable message", async () => {
    server.use(
      gateway.addEventListener("connection", ({ client }) => {
        client.send("not json");
      }),
      createHandshakeHandler(),
    );

    await expect(subscribe(vi.fn())).resolves.toBeTypeOf("function");
    expect(log.error).toHaveBeenCalledWith(
      { err: expect.any(Error), data: "not json" },
      "Failed to parse gateway message",
    );
  });

  it("should reject waiting and later subscribers when a reconnect cannot open a socket", async () => {
    server.use(
      createHandshakeHandler({
        session: { ...DEFAULT_SESSION, resume_gateway_url: "nope" },
      }),
    );

    await subscribe(vi.fn());
    getLastClient(gateway.clients)?.send(
      createPayload(GatewayOpcode.RECONNECT, null),
    );
    await vi.advanceTimersByTimeAsync(0);

    const rejected = expect(subscribe(vi.fn())).rejects.toThrow("Invalid URL");
    await vi.advanceTimersByTimeAsync(2000);

    await rejected;
    expect(log.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Failed to open gateway connection",
    );
    await expect(subscribe(vi.fn())).rejects.toThrow("Invalid URL");
  });

  it("should drop the callback of a subscribe that failed to connect", async () => {
    server.use(createHandshakeHandler());
    const failed = vi.fn();
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          throw new Error("No socket");
        }
      },
    );

    await expect(subscribe(failed)).rejects.toThrow("No socket");
    vi.unstubAllGlobals();
    await subscribe(vi.fn());

    expect(failed).not.toHaveBeenCalled();
  });

  it("should reject every connect after a fatal close without opening a socket", async () => {
    server.use(createHandshakeHandler());

    await subscribe(vi.fn());
    getLastClient(gateway.clients)?.close(4004, "Authentication failed");
    await vi.advanceTimersByTimeAsync(0);

    await expect(subscribe(vi.fn())).rejects.toThrow(
      "Gateway closed with fatal code 4004: Authentication failed",
    );
    await vi.advanceTimersByTimeAsync(60000);
    expect(connections).toBe(1);
  });

  it("should close the socket and latch when READY cannot be parsed", async () => {
    let closeCode: number | undefined;
    server.use(
      createHandshakeHandler({
        session: {},
        onClose: (event) => {
          closeCode = event.code;
        },
      }),
    );

    await expect(subscribe(vi.fn())).rejects.toBeInstanceOf(z.ZodError);
    expect(log.error).toHaveBeenCalledWith(
      { err: expect.any(Error), data: {} },
      "Invalid READY payload",
    );

    await vi.advanceTimersByTimeAsync(60000);
    expect(closeCode).toBe(4000);

    await expect(subscribe(vi.fn())).rejects.toBeInstanceOf(z.ZodError);
    expect(connections).toBe(1);
  });

  it("should tell status subscribers when the gateway drops and recovers", async () => {
    server.use(createHandshakeHandler());
    await subscribe(vi.fn());
    const onStatus = vi.fn();
    const unsubscribe = subscribeToStatus(onStatus);

    getLastClient(gateway.clients)?.close(4000, "Dropped");
    await vi.advanceTimersByTimeAsync(0);
    expect(onStatus).toHaveBeenLastCalledWith(false);

    await vi.advanceTimersByTimeAsync(2000);
    expect(onStatus).toHaveBeenLastCalledWith(true);
    expect(onStatus).toHaveBeenCalledTimes(2);

    unsubscribe();
    getLastClient(gateway.clients)?.close(4000, "Dropped");
    await vi.advanceTimersByTimeAsync(0);
    expect(onStatus).toHaveBeenCalledTimes(2);
  });

  it("should log a throwing status subscriber and still notify the rest", async () => {
    server.use(createHandshakeHandler());
    await subscribe(vi.fn());
    const onStatus = vi.fn();
    subscribeToStatus(() => {
      throw new Error("Subscriber failed");
    });
    subscribeToStatus(onStatus);

    getLastClient(gateway.clients)?.close(4000, "Dropped");
    await vi.advanceTimersByTimeAsync(0);

    expect(log.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Status subscriber callback error",
    );
    expect(onStatus).toHaveBeenCalledWith(false);
  });

  it("should let subscribers wait out a reconnect backoff instead of opening a second socket", async () => {
    server.use(createHandshakeHandler());

    await subscribe(vi.fn());
    getLastClient(gateway.clients)?.close(4000, "Dropped");
    await vi.advanceTimersByTimeAsync(0);

    const subscribed = subscribe(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(connections).toBe(1);

    await vi.advanceTimersByTimeAsync(2000);

    await expect(subscribed).resolves.toBeTypeOf("function");
    expect(connections).toBe(2);
  });

  it("should send RESUME instead of IDENTIFY on reconnect", async () => {
    server.use(createHandshakeHandler({ session: RESUME_SESSION }));
    const resumes = recordResumes();

    await subscribe(vi.fn());
    getLastClient(gateway.clients)?.send(
      createPayload(GatewayOpcode.RECONNECT, null),
    );
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);

    expect(resumes).toMatchObject([
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

  it.each([
    [
      "a non-resumable INVALID_SESSION",
      (client: Client) =>
        client.send(createPayload(GatewayOpcode.INVALID_SESSION, false)),
    ],
    [
      "a close with a re-identify code",
      (client: Client) => client.close(4007, "Invalid seq"),
    ],
  ])("should re-identify after %s", async (_, end) => {
    const sent: Payload[] = [];
    server.use(
      createHandshakeHandler({
        session: RESUME_SESSION,
        onMessage: (payload) => sent.push(payload),
      }),
    );

    await subscribe(vi.fn());
    const first = getLastClient(gateway.clients);
    if (first) end(first);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);

    expect(
      sent.flatMap(({ op }) => (op === GatewayOpcode.HEARTBEAT ? [] : [op])),
    ).toEqual([GatewayOpcode.IDENTIFY, GatewayOpcode.IDENTIFY]);
    expect(connections).toBe(2);
  });

  it("should resume a session that followed a non-resumable INVALID_SESSION", async () => {
    server.use(createHandshakeHandler({ session: RESUME_SESSION }));
    const resumes = recordResumes();

    await subscribe(vi.fn());
    getLastClient(gateway.clients)?.send(
      createPayload(GatewayOpcode.INVALID_SESSION, false),
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(resumes).toEqual([]);

    getLastClient(gateway.clients)?.close(4000, "Dropped");
    await vi.advanceTimersByTimeAsync(2000);

    expect(resumes).toMatchObject([{ op: GatewayOpcode.RESUME }]);
  });

  it("should resume after a resumable INVALID_SESSION", async () => {
    server.use(createHandshakeHandler({ session: RESUME_SESSION }));
    const resumes = recordResumes();

    await subscribe(vi.fn());
    getLastClient(gateway.clients)?.send(
      createPayload(GatewayOpcode.INVALID_SESSION, true),
    );
    await vi.advanceTimersByTimeAsync(2000);

    expect(resumes).toMatchObject([{ op: GatewayOpcode.RESUME }]);
  });

  describe("dead sockets", () => {
    // A dead peer never answers the close handshake, so onclose never fires.
    class DeadSocket {
      static readonly OPEN = 1;
      static instances: DeadSocket[] = [];
      readyState = DeadSocket.OPEN;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      constructor() {
        DeadSocket.instances.push(this);
      }
      send() {}
      close() {}
      receive(...args: Parameters<typeof createPayload>) {
        this.onmessage?.({ data: createPayload(...args) });
      }
    }

    beforeEach(() => {
      DeadSocket.instances = [];
      vi.stubGlobal("WebSocket", DeadSocket);
    });

    it("should reconnect after a heartbeat timeout and ignore the old socket", async () => {
      const callback = vi.fn();

      const subscribed = subscribe(callback);
      const [socket] = DeadSocket.instances;
      socket?.receive(GatewayOpcode.HELLO, { heartbeat_interval: 1000 });
      socket?.receive(GatewayOpcode.DISPATCH, DEFAULT_SESSION, 1, "READY");
      await subscribed;

      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      expect(DeadSocket.instances).toHaveLength(2);

      callback.mockClear();
      socket?.receive(
        GatewayOpcode.DISPATCH,
        { id: "late", channel_id: CHANNEL },
        2,
        "MESSAGE_DELETE",
      );
      expect(callback).not.toHaveBeenCalled();
    });

    it("should reconnect when HELLO never arrives", async () => {
      void subscribe(vi.fn());
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.advanceTimersByTimeAsync(2000);

      expect(DeadSocket.instances).toHaveLength(2);
    });

    it("should reconnect when HELLO cannot be parsed", async () => {
      void subscribe(vi.fn());
      DeadSocket.instances[0]?.receive(GatewayOpcode.HELLO, {});
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.advanceTimersByTimeAsync(2000);

      expect(log.info).toHaveBeenCalledWith(
        { code: 4000, reason: "No HELLO" },
        "Gateway connection closed",
      );
      expect(DeadSocket.instances).toHaveLength(2);
    });

    it("should stop the HELLO watchdog once HELLO arrives", async () => {
      const subscribed = subscribe(vi.fn());
      const [socket] = DeadSocket.instances;
      socket?.receive(GatewayOpcode.HELLO, { heartbeat_interval: 60_000 });
      socket?.receive(GatewayOpcode.DISPATCH, DEFAULT_SESSION, 1, "READY");
      await subscribed;
      await vi.advanceTimersByTimeAsync(12_000);

      expect(DeadSocket.instances).toHaveLength(1);
    });

    it("should close at once on an invalid READY without waiting for the socket", async () => {
      const subscribed = subscribe(vi.fn());
      const [socket] = DeadSocket.instances;
      socket?.receive(GatewayOpcode.HELLO, { heartbeat_interval: 60_000 });
      socket?.receive(GatewayOpcode.DISPATCH, {}, 1, "READY");

      await expect(subscribed).rejects.toThrow();
      expect(log.info).toHaveBeenCalledWith(
        { code: 4000, reason: "Invalid READY" },
        "Gateway connection closed",
      );
      await vi.advanceTimersByTimeAsync(60_000);
      expect(DeadSocket.instances).toHaveLength(1);
    });
  });

  describe("events", () => {
    it("should pass the parsed message on MESSAGE_CREATE", async () => {
      const { callback } = await subscribed();

      await dispatch("MESSAGE_CREATE", {
        ...message("msg-123"),
        pinned: false,
      });

      expect(callback).toHaveBeenCalledExactlyOnceWith({
        t: "MESSAGE_CREATE",
        d: message("msg-123"),
      });
    });

    it("should pass a MESSAGE_UPDATE that carries only some fields", async () => {
      const { callback } = await subscribed();

      await dispatch("MESSAGE_UPDATE", { id: "msg-123", channel_id: CHANNEL });

      expect(callback).toHaveBeenCalledExactlyOnceWith({
        t: "MESSAGE_UPDATE",
        d: { id: "msg-123", channel_id: CHANNEL },
      });
    });

    const thumbsUp = { id: null, name: "👍" };
    const userReaction = {
      message_id: "msg-1",
      channel_id: CHANNEL,
      user_id: "user-123",
      emoji: thumbsUp,
    };

    it.each([
      ["MESSAGE_DELETE", { id: "msg-1", channel_id: CHANNEL }],
      ["MESSAGE_DELETE_BULK", { ids: ["msg-1", "msg-2"], channel_id: CHANNEL }],
      ["MESSAGE_REACTION_ADD", userReaction],
      ["MESSAGE_REACTION_REMOVE", userReaction],
      [
        "MESSAGE_REACTION_REMOVE_ALL",
        { message_id: "msg-1", channel_id: CHANNEL },
      ],
      [
        "MESSAGE_REACTION_REMOVE_EMOJI",
        { message_id: "msg-1", channel_id: CHANNEL, emoji: thumbsUp },
      ],
      [
        "TYPING_START",
        {
          channel_id: CHANNEL,
          user_id: "user-123",
          member: { nick: "Simon", user: { username: "simon" } },
        },
      ],
    ])("should pass %s", async (event, data) => {
      const { callback } = await subscribed();

      await dispatch(event, data);

      expect(callback).toHaveBeenCalledExactlyOnceWith({ t: event, d: data });
    });

    it("should log and skip an event for our channel that doesn't parse", async () => {
      const { callback } = await subscribed();

      await dispatch("MESSAGE_DELETE", { channel_id: CHANNEL });

      expect(callback).toHaveBeenCalledExactlyOnceWith({ t: "MISSED" });
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "MESSAGE_DELETE" }),
        "Invalid channel event",
      );
    });

    it("should ignore events the site doesn't use", async () => {
      const { callback } = await subscribed();

      await dispatch("CHANNEL_PINS_UPDATE", { channel_id: CHANNEL });

      expect(callback).not.toHaveBeenCalled();
    });
  });
});
