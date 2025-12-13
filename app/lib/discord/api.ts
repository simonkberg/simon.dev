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

// Bot constants
export const BOT_USERNAME = "simon-bot" as Username;
export const BOT_PREFIX = `${BOT_USERNAME}: `;
const BOT_MENTION_PATTERN = /\bsimon[- ]?bot\b/i;

export function isBotMessage(content: string): boolean {
  return content.startsWith(BOT_PREFIX);
}

export function mentionsBot(content: string): boolean {
  return BOT_MENTION_PATTERN.test(content);
}

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

function parseMarkdown(content: string): string {
  return SimpleMarkdown.defaultHtmlOutput(
    SimpleMarkdown.defaultInlineParse(content),
  );
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
  message_reference: z.object({ message_id: z.string().optional() }).optional(),
});

type DiscordMessage = z.infer<typeof DiscordMessageSchema>;

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

    const message = Promise.try(async () => {
      const match = discordMessage.content.match(/^(.+?): (.*)$/s);

      const user = match
        ? toUser(match[1]!)
        : await userLoader.load(discordMessage.author.id);

      const content = (match?.[2] ?? discordMessage.content).trim();

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
  isBot: boolean;
};

export async function getMessageChain(
  messageId: string,
): Promise<ChainMessage[]> {
  const chain: ChainMessage[] = [];
  let currentId: string | undefined = messageId;

  while (currentId) {
    const response: DiscordMessage = await call(
      "GET",
      `channels/${env.DISCORD_CHANNEL_ID}/messages/${currentId}`,
      DiscordMessageSchema,
    );

    const isBot = isBotMessage(response.content);

    // Parse username from content prefix or lookup via API
    let username: string;
    let content: string;

    if (isBot) {
      username = BOT_USERNAME;
      content = response.content.slice(BOT_PREFIX.length);
    } else {
      const match = response.content.match(/^(.+?): (.*)$/s);
      if (match) {
        username = match[1]!;
        content = match[2]!.trim();
      } else {
        const member = await getGuildMember(response.author.id);
        username =
          member.nick ?? member.user.global_name ?? member.user.username;
        content = response.content.trim();
      }
    }

    chain.unshift({
      id: response.id,
      type: response.type,
      username,
      content,
      isBot,
    });

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
