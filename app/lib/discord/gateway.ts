import "server-only";

import { z } from "zod";

import { env } from "@/lib/env";
import { log } from "@/lib/log";

import { type DiscordMessage, DiscordMessageSchema } from "./schemas";

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

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const GATEWAY_INTENTS = 1 << 9; // GUILD_MESSAGES

// Close codes that require fresh identify (not resume)
const RE_IDENTIFY_CLOSE_CODES = new Set([4003, 4007, 4009]);
// Close codes that are fatal (don't reconnect)
const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

const GatewayPayloadSchema = z.object({
  op: z.number(),
  d: z.unknown(),
  s: z.number().nullable(),
  t: z.string().nullable(),
});

const HelloDataSchema = z.object({ heartbeat_interval: z.number() });

const ReadyDataSchema = z.object({
  session_id: z.string(),
  resume_gateway_url: z.string(),
});

const MessageEventDataSchema = z.object({ channel_id: z.string() });

export type MessageSubscriber = (message: DiscordMessage) => void;

class DiscordGateway {
  #ws: WebSocket | null = null;
  #subscribers = new Set<() => void>();
  #messageSubscribers = new Set<MessageSubscriber>();

  // Session state (for resume)
  #sessionId: string | null = null;
  #resumeGatewayUrl: string | null = null;
  #seq: number | null = null;

  // Heartbeat state
  #heartbeatInterval: number | null = null;
  #heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  #awaitingAck = false;

  // Reconnection state
  #reconnectAttempts = 0;
  #shouldResume = true;

  get connected(): boolean {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  addSubscriber(callback: () => void): void {
    this.#subscribers.add(callback);
  }

  removeSubscriber(callback: () => void): void {
    this.#subscribers.delete(callback);
  }

  #notifySubscribers(): void {
    for (const callback of this.#subscribers) {
      try {
        callback();
      } catch (err) {
        log.error({ err }, "Subscriber callback error");
      }
    }
  }

  addMessageSubscriber(callback: MessageSubscriber): void {
    this.#messageSubscribers.add(callback);
  }

  removeMessageSubscriber(callback: MessageSubscriber): void {
    this.#messageSubscribers.delete(callback);
  }

  #notifyMessageSubscribers(message: DiscordMessage): void {
    for (const callback of this.#messageSubscribers) {
      try {
        callback(message);
      } catch (err) {
        log.error({ err }, "Message subscriber callback error");
      }
    }
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url =
        this.#shouldResume && this.#resumeGatewayUrl
          ? `${this.#resumeGatewayUrl}/?v=10&encoding=json`
          : GATEWAY_URL;

      log.info(
        { url, resume: this.#shouldResume },
        "Connecting to Discord Gateway",
      );

      this.#ws = new WebSocket(url);

      this.#ws.onopen = () => {
        log.debug("Gateway connection opened");
      };

      this.#ws.onclose = (event) => {
        this.#handleClose(event.code, event.reason);
      };

      this.#ws.onerror = (event) => {
        log.error({ error: event }, "Gateway WebSocket error");
      };

      this.#ws.onmessage = (event) => {
        this.#handleMessage(String(event.data), resolve, reject);
      };
    });
  }

  #send(op: number, d: unknown): void {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify({ op, d }));
    }
  }

  #identify(): void {
    log.debug("Sending IDENTIFY");
    this.#send(GatewayOpcode.IDENTIFY, {
      token: env.DISCORD_BOT_TOKEN,
      intents: GATEWAY_INTENTS,
      properties: { os: "linux", browser: "simon.dev", device: "simon.dev" },
    });
  }

  #resume(): void {
    log.debug("Sending RESUME");
    this.#send(GatewayOpcode.RESUME, {
      token: env.DISCORD_BOT_TOKEN,
      session_id: this.#sessionId,
      seq: this.#seq,
    });
  }

  #startHeartbeat(interval: number): void {
    this.#heartbeatInterval = interval;
    const jitter = interval * Math.random();

    log.debug({ interval, jitter }, "Starting heartbeat");

    this.#heartbeatTimer = setTimeout(() => this.#heartbeat(), jitter);
  }

  #stopHeartbeat(): void {
    if (this.#heartbeatTimer) {
      clearTimeout(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
  }

  #heartbeat(): void {
    if (this.#awaitingAck) {
      log.warn("No heartbeat ACK received, reconnecting");
      this.#ws?.close(4000, "Heartbeat timeout");
      return;
    }

    log.debug({ seq: this.#seq }, "Sending HEARTBEAT");
    this.#send(GatewayOpcode.HEARTBEAT, this.#seq);
    this.#awaitingAck = true;

    if (this.#heartbeatInterval) {
      this.#heartbeatTimer = setTimeout(
        () => this.#heartbeat(),
        this.#heartbeatInterval,
      );
    }
  }

  #handleMessage(
    data: string,
    onReady: () => void,
    onError: (err: Error) => void,
  ): void {
    try {
      const payload = GatewayPayloadSchema.parse(JSON.parse(data));

      switch (payload.op) {
        case GatewayOpcode.DISPATCH:
          this.#handleDispatch(payload.s, payload.t, payload.d, onReady);
          break;

        case GatewayOpcode.HEARTBEAT:
          // Discord requests immediate heartbeat
          this.#send(GatewayOpcode.HEARTBEAT, this.#seq);
          break;

        case GatewayOpcode.RECONNECT:
          log.info("Received RECONNECT, closing connection");
          this.#shouldResume = true;
          this.#ws?.close(4000, "Reconnect requested");
          break;

        case GatewayOpcode.INVALID_SESSION:
          log.info({ resumable: payload.d }, "Received INVALID_SESSION");
          this.#shouldResume = payload.d === true;
          if (!this.#shouldResume) {
            this.#sessionId = null;
            this.#resumeGatewayUrl = null;
            this.#seq = null;
          }
          this.#ws?.close(4000, "Invalid session");
          break;

        case GatewayOpcode.HELLO: {
          const hello = HelloDataSchema.parse(payload.d);
          this.#startHeartbeat(hello.heartbeat_interval);
          if (this.#shouldResume && this.#sessionId) {
            this.#resume();
          } else {
            this.#identify();
          }
          break;
        }

        case GatewayOpcode.HEARTBEAT_ACK:
          log.debug("Received HEARTBEAT_ACK");
          this.#awaitingAck = false;
          break;
      }
    } catch (err) {
      log.error({ err, data }, "Failed to parse gateway message");
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  #handleDispatch(
    seq: number | null,
    eventName: string | null,
    data: unknown,
    onReady: () => void,
  ): void {
    // Update sequence number
    if (seq !== null) {
      this.#seq = seq;
    }

    switch (eventName) {
      case "READY": {
        const ready = ReadyDataSchema.parse(data);
        this.#sessionId = ready.session_id;
        this.#resumeGatewayUrl = ready.resume_gateway_url;
        this.#reconnectAttempts = 0;
        log.info({ sessionId: this.#sessionId }, "Gateway READY");
        onReady();
        break;
      }

      case "RESUMED":
        this.#reconnectAttempts = 0;
        log.info("Gateway RESUMED");
        onReady();
        break;

      case "MESSAGE_CREATE": {
        const parsed = DiscordMessageSchema.safeParse(data);
        if (
          parsed.success &&
          parsed.data.channel_id === env.DISCORD_CHANNEL_ID
        ) {
          log.debug({ event: eventName }, "Message event for our channel");
          this.#notifySubscribers();
          this.#notifyMessageSubscribers(parsed.data);
        }
        break;
      }

      case "MESSAGE_UPDATE":
      case "MESSAGE_DELETE": {
        const parsed = MessageEventDataSchema.safeParse(data);
        if (
          parsed.success &&
          parsed.data.channel_id === env.DISCORD_CHANNEL_ID
        ) {
          log.debug({ event: eventName }, "Message event for our channel");
          this.#notifySubscribers();
        }
        break;
      }
    }
  }

  #handleClose(code: number, reason: string): void {
    log.info({ code, reason }, "Gateway connection closed");

    this.#stopHeartbeat();
    this.#awaitingAck = false;
    this.#ws = null;

    // Check if we should reconnect
    if (FATAL_CLOSE_CODES.has(code)) {
      log.error({ code }, "Fatal gateway close code, not reconnecting");
      return;
    }

    // Check if we need to re-identify instead of resume
    if (RE_IDENTIFY_CLOSE_CODES.has(code)) {
      this.#shouldResume = false;
      this.#sessionId = null;
      this.#resumeGatewayUrl = null;
      this.#seq = null;
    }

    // Reconnect with exponential backoff
    this.#reconnectAttempts++;
    const backoff = Math.min(1000 * 2 ** this.#reconnectAttempts, 30000);

    log.info({ backoff, attempt: this.#reconnectAttempts }, "Reconnecting");

    setTimeout(() => {
      void this.connect().catch((err) => {
        log.error({ err }, "Reconnection failed");
      });
    }, backoff);
  }
}

let gateway: DiscordGateway | null = null;

function getGateway(): DiscordGateway {
  if (!gateway) {
    gateway = new DiscordGateway();
  }
  return gateway;
}

export async function subscribe(callback: () => void): Promise<() => void> {
  const gw = getGateway();
  gw.addSubscriber(callback);

  if (!gw.connected) {
    await gw.connect();
  }

  return () => gw.removeSubscriber(callback);
}

export async function subscribeToMessages(
  callback: MessageSubscriber,
): Promise<() => void> {
  const gw = getGateway();
  gw.addMessageSubscriber(callback);

  if (!gw.connected) {
    await gw.connect();
  }

  return () => gw.removeMessageSubscriber(callback);
}
