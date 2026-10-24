import "server-only";
import { z } from "zod";

import { env } from "@/lib/env";
import { getGlobal } from "@/lib/global";
import { log } from "@/lib/log";

import {
  type ChannelEvent,
  ChannelEventSchema,
  type GuildCreate,
  GuildCreateSchema,
  type PresenceUpdate,
  PresenceUpdateSchema,
  type TypingStart,
  TypingStartSchema,
} from "./schemas";

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
// MESSAGE_CONTENT too, or a Discord user's text arrives empty and their mentions never match.
// GUILDS sends GUILD_CREATE, and GUILD_PRESENCES, privileged too, puts every member and who is online in it.
const GATEWAY_INTENTS =
  (1 << 0) | (1 << 8) | (1 << 9) | (1 << 10) | (1 << 11) | (1 << 15); // GUILDS, GUILD_PRESENCES, GUILD_MESSAGES, GUILD_MESSAGE_REACTIONS, GUILD_MESSAGE_TYPING, MESSAGE_CONTENT

const HELLO_TIMEOUT_MS = 10_000;

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
  user: z.object({ id: z.string() }),
  session_id: z.string(),
  resume_gateway_url: z.string(),
});

const MessageEventDataSchema = z.object({ channel_id: z.string() });

const CHANNEL_EVENTS: ReadonlySet<string> = new Set(
  ChannelEventSchema.options.map((option) => option.shape.t.value),
);

/**
 * A `READY` starts a new session: events missed since the last one are lost, not replayed.
 * A `MISSED` is a channel event that couldn't be read.
 */
export type GatewayEvent =
  | ChannelEvent
  | { t: "TYPING_START"; d: TypingStart }
  | { t: "GUILD_CREATE"; d: GuildCreate }
  | { t: "PRESENCE_UPDATE"; d: PresenceUpdate }
  | { t: "READY" }
  | { t: "MISSED" };

export type EventSubscriber = (event: GatewayEvent) => void;
export type StatusSubscriber = (ready: boolean) => void;

class DiscordGateway {
  #ws: WebSocket | null = null;
  #subscribers = new Set<EventSubscriber>();
  #statusSubscribers = new Set<StatusSubscriber>();

  // Session state (for resume)
  #sessionId: string | null = null;
  #userId: string | null = null;
  #resumeGatewayUrl: string | null = null;
  #seq: number | null = null;

  // Heartbeat state
  #heartbeatInterval: number | null = null;
  #heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  #helloTimer: ReturnType<typeof setTimeout> | null = null;
  #awaitingAck = false;

  // Reconnection state
  #reconnectAttempts = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Settles on whichever attempt reaches READY; rejects only when no later attempt can succeed.
  #pending: PromiseWithResolvers<void> | null = null;
  #ready = false;
  // Set when no retry with this config can succeed; retrying would re-send IDENTIFY, and Discord resets the token past its daily limit.
  #fatal: Error | null = null;

  addSubscriber(callback: EventSubscriber): void {
    this.#subscribers.add(callback);
  }

  removeSubscriber(callback: EventSubscriber): void {
    this.#subscribers.delete(callback);
  }

  #notifySubscribers(event: GatewayEvent): void {
    for (const callback of this.#subscribers) {
      try {
        callback(event);
      } catch (err) {
        log.error({ err }, "Subscriber callback error");
      }
    }
  }

  get userId(): string | null {
    return this.#userId;
  }

  addStatusSubscriber(callback: StatusSubscriber): void {
    this.#statusSubscribers.add(callback);
  }

  removeStatusSubscriber(callback: StatusSubscriber): void {
    this.#statusSubscribers.delete(callback);
  }

  #setReady(ready: boolean): void {
    if (this.#ready === ready) return;
    this.#ready = ready;
    for (const callback of this.#statusSubscribers) {
      try {
        callback(ready);
      } catch (err) {
        log.error({ err }, "Status subscriber callback error");
      }
    }
  }

  connect(): Promise<void> {
    if (this.#fatal) return Promise.reject(this.#fatal);
    if (this.#ready) return Promise.resolve();

    const { promise } = (this.#pending ??= Promise.withResolvers<void>());
    if (!this.#ws && !this.#reconnectTimer) {
      this.#tryOpen();
    }
    return promise;
  }

  #tryOpen(): void {
    try {
      this.#open();
    } catch (err) {
      log.error({ err }, "Failed to open gateway connection");
      this.#onConnectFailed(err);
    }
  }

  #open(): void {
    const url = this.#resumeGatewayUrl
      ? `${this.#resumeGatewayUrl}/?v=10&encoding=json`
      : GATEWAY_URL;

    log.info(
      { url, resume: this.#sessionId !== null },
      "Connecting to Discord Gateway",
    );

    const ws = new WebSocket(url);
    this.#ws = ws;
    // Discord sends HELLO right away; a socket that never does is as dead as one that stops ACKing.
    this.#helloTimer = setTimeout(
      () => this.#abandon(4000, "No HELLO"),
      HELLO_TIMEOUT_MS,
    );

    ws.onopen = () => {
      log.debug("Gateway connection opened");
    };

    // An abandoned socket can still deliver events; only the current one counts.
    ws.onclose = (event) => {
      if (this.#ws === ws) this.#handleClose(event.code, event.reason);
    };

    ws.onerror = (event) => {
      log.error({ error: event }, "Gateway WebSocket error");
    };

    ws.onmessage = (event) => {
      if (this.#ws === ws) this.#handleMessage(String(event.data));
    };
  }

  #onReady(): void {
    this.#setReady(true);
    this.#pending?.resolve();
    this.#pending = null;
  }

  #onConnectFailed(err: unknown): void {
    this.#pending?.reject(err);
    this.#pending = null;
  }

  #latchFatal(err: Error): void {
    this.#fatal = err;
    this.#onConnectFailed(err);
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
    this.#stopHeartbeat();
    this.#heartbeatInterval = interval;
    const jitter = interval * Math.random();

    log.debug({ interval, jitter }, "Starting heartbeat");

    this.#heartbeatTimer = setTimeout(() => this.#heartbeat(), jitter);
  }

  #stopHelloTimer(): void {
    if (this.#helloTimer) {
      clearTimeout(this.#helloTimer);
      this.#helloTimer = null;
    }
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
      this.#abandon(4000, "Heartbeat timeout");
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

  #handleMessage(data: string): void {
    try {
      const payload = GatewayPayloadSchema.parse(JSON.parse(data));

      switch (payload.op) {
        case GatewayOpcode.DISPATCH:
          this.#handleDispatch(payload.s, payload.t, payload.d);
          break;

        case GatewayOpcode.HEARTBEAT:
          // Discord requests immediate heartbeat
          this.#send(GatewayOpcode.HEARTBEAT, this.#seq);
          break;

        case GatewayOpcode.RECONNECT:
          log.info("Received RECONNECT, closing connection");
          this.#abandon(4000, "Reconnect requested");
          break;

        case GatewayOpcode.INVALID_SESSION:
          log.info({ resumable: payload.d }, "Received INVALID_SESSION");
          if (payload.d !== true) {
            this.#sessionId = null;
            this.#resumeGatewayUrl = null;
            this.#seq = null;
          }
          this.#abandon(4000, "Invalid session");
          break;

        case GatewayOpcode.HELLO: {
          const hello = HelloDataSchema.parse(payload.d);
          this.#stopHelloTimer();
          this.#startHeartbeat(hello.heartbeat_interval);
          if (this.#sessionId) {
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
    }
  }

  #handleDispatch(
    seq: number | null,
    eventName: string | null,
    data: unknown,
  ): void {
    // Update sequence number
    if (seq !== null) {
      this.#seq = seq;
    }

    switch (eventName) {
      case "READY": {
        const parsed = ReadyDataSchema.safeParse(data);
        if (!parsed.success) {
          log.error({ err: parsed.error, data }, "Invalid READY payload");
          this.#latchFatal(parsed.error);
          this.#abandon(4000, "Invalid READY");
          break;
        }
        const ready = parsed.data;
        this.#sessionId = ready.session_id;
        this.#resumeGatewayUrl = ready.resume_gateway_url;
        this.#reconnectAttempts = 0;
        log.info({ sessionId: this.#sessionId }, "Gateway READY");
        this.#userId = ready.user.id;
        this.#notifySubscribers({ t: "READY" });
        this.#onReady();
        break;
      }

      case "RESUMED":
        this.#reconnectAttempts = 0;
        log.info("Gateway RESUMED");
        this.#onReady();
        break;

      // Typing and presence change no message, so one that can't be read is dropped rather than missed.
      case "TYPING_START": {
        const { data: typing } = TypingStartSchema.safeParse(data);
        if (typing?.channel_id === env.DISCORD_CHANNEL_ID) {
          this.#notifySubscribers({ t: "TYPING_START", d: typing });
        }
        break;
      }

      case "GUILD_CREATE": {
        const { data: guild } = GuildCreateSchema.safeParse(data);
        if (guild?.id === env.DISCORD_GUILD_ID) {
          this.#notifySubscribers({ t: "GUILD_CREATE", d: guild });
        }
        break;
      }

      case "PRESENCE_UPDATE": {
        const { data: presence } = PresenceUpdateSchema.safeParse(data);
        if (presence?.guild_id === env.DISCORD_GUILD_ID) {
          this.#notifySubscribers({ t: "PRESENCE_UPDATE", d: presence });
        }
        break;
      }

      default: {
        if (eventName === null || !CHANNEL_EVENTS.has(eventName)) break;
        const { data: target } = MessageEventDataSchema.safeParse(data);
        if (target?.channel_id !== env.DISCORD_CHANNEL_ID) break;

        const parsed = ChannelEventSchema.safeParse({ t: eventName, d: data });
        if (!parsed.success) {
          log.warn({ err: parsed.error, eventName }, "Invalid channel event");
          this.#notifySubscribers({ t: "MISSED" });
          break;
        }
        log.debug({ event: eventName }, "Message event for our channel");
        this.#notifySubscribers(parsed.data);
        break;
      }
    }
  }

  // A dead connection may never finish the close handshake, so this doesn't wait for onclose.
  #abandon(code: number, reason: string): void {
    this.#ws?.close(code, reason);
    this.#handleClose(code, reason);
  }

  #handleClose(code: number, reason: string): void {
    log.info({ code, reason }, "Gateway connection closed");

    this.#stopHelloTimer();
    this.#stopHeartbeat();
    this.#awaitingAck = false;
    this.#ws = null;
    this.#setReady(false);

    // Check if we should reconnect
    if (FATAL_CLOSE_CODES.has(code)) {
      log.error({ code }, "Fatal gateway close code, not reconnecting");
      this.#latchFatal(
        new Error(`Gateway closed with fatal code ${code}: ${reason}`),
      );
      return;
    }
    if (this.#fatal) return;

    // Check if we need to re-identify instead of resume
    if (RE_IDENTIFY_CLOSE_CODES.has(code)) {
      this.#sessionId = null;
      this.#resumeGatewayUrl = null;
      this.#seq = null;
    }

    // Reconnect with exponential backoff
    this.#reconnectAttempts++;
    const backoff = Math.min(1000 * 2 ** this.#reconnectAttempts, 30000);

    log.info({ backoff, attempt: this.#reconnectAttempts }, "Reconnecting");

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#tryOpen();
    }, backoff);
  }
}

function getGateway(): DiscordGateway {
  return getGlobal("discord-gateway", () => new DiscordGateway());
}

/** Calls back with every new session, every message, reaction and typing event in the site's channel, and who is online in its guild. */
export async function subscribe(
  callback: EventSubscriber,
): Promise<() => void> {
  const gw = getGateway();
  gw.addSubscriber(callback);
  try {
    await gw.connect();
  } catch (err) {
    gw.removeSubscriber(callback);
    throw err;
  }
  return () => gw.removeSubscriber(callback);
}

export function connect(): Promise<void> {
  return getGateway().connect();
}

/** The bot's own user id, once the gateway has identified. */
export function getBotUserId(): string | null {
  return getGateway().userId;
}

/** Called with `false` when the gateway drops and `true` once it's back. */
export function subscribeToStatus(callback: StatusSubscriber): () => void {
  const gw = getGateway();
  gw.addStatusSubscriber(callback);
  return () => gw.removeStatusSubscriber(callback);
}
