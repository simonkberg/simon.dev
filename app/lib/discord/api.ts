import "server-only";

import SimpleMarkdown from "@khanacademy/simple-markdown";
import { comparing, stringComparator } from "comparator.ts";
import DataLoader from "dataloader";
import { z } from "zod";

import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { LruMap } from "@/lib/LruMap";
import { stringToColor } from "@/lib/stringToColor";

import type { Username } from "../session";
import { type DiscordMessage, DiscordMessageSchema } from "./schemas";

const BASE_URL = "https://discord.com/api/v10";
const RATE_LIMIT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 5;

const RateLimitResponseSchema = z.object({
  message: z.string(),
  retry_after: z.number(),
  global: z.boolean(),
  code: z.number().optional(),
});

// Per-endpoint rate limit tracking: endpoint → timestamp until which requests should wait
const rateLimitUntil = new Map<string, number>();

/** @internal Exported for test cleanup only */
export function _resetRateLimitState(): void {
  rateLimitUntil.clear();
}

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

  const startTime = performance.now();
  let retries = 0;

  while (true) {
    // Wait for any active rate limit gate on this endpoint
    const waitUntil = rateLimitUntil.get(endpoint);
    if (waitUntil != null) {
      const waitMs = waitUntil - Date.now();
      if (waitMs > 0) {
        const elapsedMs = performance.now() - startTime;
        if (elapsedMs + waitMs > RATE_LIMIT_TIMEOUT_MS) {
          log.error(
            { endpoint, elapsedMs, waitMs, retries },
            "Discord rate limit exceeded max wait time",
          );
          throw new Error(`Discord rate limit exceeded`);
        }
        await new Promise((resolve) => setTimeout(resolve, waitMs));
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

    if (response.status === 429) {
      retries++;

      const rateLimit = RateLimitResponseSchema.safeParse(json);
      const retryAfterMs = rateLimit.success
        ? rateLimit.data.retry_after * 1000
        : 1000;
      const global = rateLimit.success && rateLimit.data.global;

      const elapsedMs = performance.now() - startTime;

      if (
        retries > MAX_RETRIES ||
        elapsedMs + retryAfterMs > RATE_LIMIT_TIMEOUT_MS
      ) {
        log.error(
          { endpoint, elapsedMs, retryAfterMs, global, retries },
          "Discord rate limit exceeded max wait time",
        );
        throw new Error(`Discord rate limit exceeded`);
      }

      // Update shared rate limit gate (Math.max avoids overwriting a longer wait)
      const newUntil = Date.now() + retryAfterMs;
      const existing = rateLimitUntil.get(endpoint) ?? 0;
      rateLimitUntil.set(endpoint, Math.max(existing, newUntil));

      log.warn(
        { endpoint, retryAfterMs, global, retries },
        "Discord rate limited, retrying",
      );

      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      continue;
    }

    // Clear rate limit gate on success
    rateLimitUntil.delete(endpoint);

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

function parseMarkdown(content: string): string {
  return SimpleMarkdown.defaultHtmlOutput(
    SimpleMarkdown.defaultInlineParse(content),
  );
}

const USERNAME_PREFIX_PATTERN = /^(.+?): (.*)$/s;

function parseUsernamePrefix(content: string): [string, string] | undefined {
  const match = content.match(USERNAME_PREFIX_PATTERN);
  return match ? [match[1]!, match[2]!] : undefined;
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
    ).then(flattenSettledPromises),
  { cacheMap: new LruMap(100) },
);

const discordMessageLoader = new DataLoader<string, DiscordMessage>(
  (keys) =>
    Promise.allSettled(
      keys.map((messageId) =>
        call(
          "GET",
          `channels/${env.DISCORD_CHANNEL_ID}/messages/${messageId}`,
          DiscordMessageSchema,
        ),
      ),
    ).then(flattenSettledPromises),
  { cacheMap: new LruMap(100) },
);

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

export async function getChannelMessages(limit = 50): Promise<Message[]> {
  const response = await call(
    "GET",
    `channels/${env.DISCORD_CHANNEL_ID}/messages`,
    GetMessagesResponseSchema,
    { limit },
  );

  const messages: Promise<Message>[] = [];
  const replies: Record<string, Promise<Message>[]> = {};

  for (const discordMessage of response) {
    // Only process default messages and replies
    if (discordMessage.type !== 0 && discordMessage.type !== 19) {
      continue;
    }

    discordMessageLoader.prime(discordMessage.id, discordMessage);

    const message = Promise.try(async () => {
      const parsed = parseUsernamePrefix(discordMessage.content);

      const user = parsed
        ? toUser(parsed[0])
        : await userLoader.load(discordMessage.author.id);

      const content = (parsed?.[1] ?? discordMessage.content).trim();

      return MessageSchema.decode({
        id: discordMessage.id,
        user,
        content: parseMarkdown(content),
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

export type ChainMessage = {
  id: string;
  type: number;
  username: string;
  content: string;
};

const MAX_CHAIN_DEPTH = 50;

export async function getMessageChain(
  messageId: string,
): Promise<ChainMessage[]> {
  const chain: ChainMessage[] = [];
  const seen = new Set<string>();
  let currentId: string | undefined = messageId;

  while (currentId && chain.length < MAX_CHAIN_DEPTH) {
    // Cycle detection
    if (seen.has(currentId)) break;
    seen.add(currentId);

    const response: DiscordMessage = await discordMessageLoader.load(currentId);

    // Parse username from content prefix or lookup via API
    const parsed = parseUsernamePrefix(response.content);
    const username = parsed
      ? parsed[0]
      : (await userLoader.load(response.author.id)).name;
    const content = (parsed?.[1] ?? response.content).trim();

    chain.unshift({ id: response.id, type: response.type, username, content });

    currentId = response.message_reference?.message_id;
  }

  return chain;
}

const PostChannelMessageResponseSchema = z.object({ id: z.string() });

export async function postChannelMessage(
  text: string,
  username: Username,
  replyToMessageId?: string,
): Promise<string> {
  const body = {
    content: `${username}: ${text}`,
    message_reference: replyToMessageId
      ? { message_id: replyToMessageId }
      : undefined,
  };

  const response = await call(
    "POST",
    `channels/${env.DISCORD_CHANNEL_ID}/messages`,
    PostChannelMessageResponseSchema,
    body,
  );

  return response.id;
}

function flattenSettledPromises<T>(
  promises: PromiseSettledResult<T>[],
): (T | Error)[] {
  return promises.map((res) =>
    res.status === "fulfilled"
      ? res.value
      : res.reason instanceof Error
        ? res.reason
        : /* v8 ignore next -- @preserve */
          new Error("Unknown error"),
  );
}
