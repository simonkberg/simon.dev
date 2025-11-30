import "server-only";

import { comparing, stringComparator } from "comparator.ts";
import DataLoader from "dataloader";
import { z } from "zod";

import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { LruMap } from "@/lib/LruMap";
import { stringToColor } from "@/lib/stringToColor";

import type { Username } from "./session";

const BASE_URL = "https://discord.com/api/v10";

async function call<T extends z.ZodType>(
  method: string,
  endpoint: string,
  schema: T,
  params: Record<string, unknown> = {},
): Promise<z.infer<T>> {
  const url = new URL(`${BASE_URL}/${endpoint}`);

  if (method === "GET") {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method,
    body: method === "POST" ? JSON.stringify(params) : undefined,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    },
    signal: AbortSignal.timeout(5000),
  });

  const json = await response.json();

  if (!response.ok) {
    log.error(
      { endpoint, status: response.status, body: json },
      "Discord API call failed",
    );
    throw new Error(
      `Discord API error: ${response.status} ${response.statusText}`,
    );
  }

  return schema.parse(json);
}

const GetGuildMemberResponseSchema = z.object({
  user: z.object({ username: z.string(), global_name: z.string().nullable() }),
  nick: z.string().nullable(),
});

async function getGuildMember(userId: string) {
  return call(
    "GET",
    `guilds/${env.DISCORD_GUILD_ID}/members/${userId}`,
    GetGuildMemberResponseSchema,
  );
}

const UserSchema = z.object({
  name: z.string(),
  color: z.templateLiteral([
    "hsl(",
    z.number(),
    " ",
    z.number(),
    "% ",
    z.number(),
    "%)",
  ]),
});

export type User = z.infer<typeof UserSchema>;

function toUser(name: string): User {
  return UserSchema.decode({ name, color: stringToColor(name) });
}

const userLoader = new DataLoader<string, User>(
  (keys) =>
    Promise.allSettled(
      keys.map(async (userId: string) => {
        const response = await getGuildMember(userId);
        return toUser(
          response.nick ?? response.user.global_name ?? response.user.username,
        );
      }),
    ).then((result) =>
      result.map((res) =>
        res.status === "fulfilled"
          ? res.value
          : res.reason instanceof Error
            ? res.reason
            : new Error("Unknown error"),
      ),
    ),
  { cacheMap: new LruMap(100) },
);

const DiscordMessageSchema = z.object({
  type: z.number(),
  id: z.string(),
  author: z.object({ id: z.string() }),
  content: z.string(),
  edited_timestamp: z.string().nullable(),
  components: z
    .array(z.object({ type: z.number(), label: z.string().optional() }))
    .optional(),
  message_reference: z.object({ message_id: z.string().optional() }).optional(),
});

const GetMessagesResponseSchema = z.array(DiscordMessageSchema);

const MessageSchema = z.object({
  id: z.string(),
  user: UserSchema,
  content: z.string(),
  edited: z.boolean(),
  get replies() {
    return z.array(MessageSchema);
  },
});

export type Message = z.infer<typeof MessageSchema>;

const messageIdComparator = comparing(
  (msg: Message) => msg.id,
  stringComparator,
);

export async function getChannelMessages(): Promise<Message[]> {
  const response = await call(
    "GET",
    `channels/${env.DISCORD_CHANNEL_ID}/messages`,
    GetMessagesResponseSchema,
    { limit: 50 },
  );

  const messages: Promise<Message>[] = [];
  const replies: Record<string, Promise<Message>[]> = {};

  for (const discordMessage of response) {
    // Only process default messages and replies
    if (discordMessage.type !== 0 && discordMessage.type !== 19) {
      continue;
    }

    const message = Promise.try(async () => {
      const match = discordMessage.content.match(/^(.+?): (.*)$/s);

      const user = match
        ? toUser(match[1]!)
        : await userLoader.load(discordMessage.author.id);

      const content = (match?.[2] ?? discordMessage.content).trim();

      return MessageSchema.decode({
        id: discordMessage.id,
        user,
        content,
        edited: discordMessage.edited_timestamp !== null,
        replies: [],
      });
    });

    const referencesMessageId = discordMessage.message_reference?.message_id;

    if (referencesMessageId) {
      (replies[referencesMessageId] ??= []).push(message);
    } else {
      messages.push(message);
    }
  }

  const resolveReplies = async (
    msgPromises: Promise<Message>[],
  ): Promise<Message[]> => {
    const result = await Promise.all(
      msgPromises.map(async (msgPromise) => {
        const msg = await msgPromise;
        msg.replies = await resolveReplies(replies[msg.id] ?? []);
        return msg;
      }),
    );
    return result.sort(messageIdComparator);
  };

  return resolveReplies(messages);
}

export async function postChannelMessage(
  text: string,
  username: Username,
): Promise<void> {
  await call(
    "POST",
    `channels/${env.DISCORD_CHANNEL_ID}/messages`,
    z.unknown(),
    { content: `${username}: ${text}` },
  );
}

// =============================================================================
// Gateway (WebSocket) Implementation
// =============================================================================

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

class DiscordGateway {
  #ws: WebSocket | null = null;
  #subscribers = new Set<() => void>();

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

  #startHeartbeat(interval: number, jitter = true): void {
    this.#heartbeatInterval = interval;
    const delay = jitter ? interval * Math.random() : interval;

    log.debug({ interval, delay }, "Starting heartbeat");

    this.#heartbeatTimer = setTimeout(() => this.#heartbeat(), delay);
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

      case "MESSAGE_CREATE":
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
