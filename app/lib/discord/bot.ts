import "server-only";

import { type ChatMessage, createMessage } from "@/lib/anthropic";
import { log } from "@/lib/log";
import { getRedis } from "@/lib/redis";

import type { Username } from "../session";
import { getMessageChain, postChannelMessage } from "./api";
import { subscribeToMessages } from "./gateway";
import type { DiscordMessage } from "./schemas";

// Bot identity
const BOT_USERNAME = "simon-bot" as Username;
const BOT_PREFIX = `${BOT_USERNAME}: `;
const BOT_MENTION_PATTERN = /\bsimon[- ]?bot\b/i;

function isBotMessage(content: string): boolean {
  return content.startsWith(BOT_PREFIX);
}

function mentionsBot(content: string): boolean {
  return BOT_MENTION_PATTERN.test(content);
}

const SEEN_PREFIX = "discord:seen:";
const SEEN_TTL = 60;

async function markSeen(messageId: string): Promise<boolean> {
  const result = await getRedis().set(`${SEEN_PREFIX}${messageId}`, "1", {
    nx: true,
    ex: SEEN_TTL,
  });
  return result === "OK";
}

export async function handleMessage(message: DiscordMessage): Promise<void> {
  try {
    // Only respond to default messages (0) and replies (19)
    if (message.type !== 0 && message.type !== 19) return;

    // Skip our own messages
    if (isBotMessage(message.content)) return;

    // Dedup across instances
    const isNew = await markSeen(message.id);
    if (!isNew) return;

    // Fetch the reply chain
    const chain = await getMessageChain(message.id);
    if (chain.length === 0) return;

    // Check if bot is mentioned anywhere in chain
    if (!chain.some((m) => mentionsBot(m.content))) return;

    // Build conversation for Anthropic
    const messages = chain.map((m) => ({
      role:
        m.username === BOT_USERNAME
          ? ("assistant" as const)
          : ("user" as const),
      username: m.username,
      content: m.content,
    })) as [ChatMessage, ...ChatMessage[]];

    // Generate and post response
    for await (const response of createMessage(messages)) {
      await postChannelMessage(response, BOT_USERNAME, message.id);
    }

    log.info({ messageId: message.id }, "Bot responded to message");
  } catch (err) {
    log.error({ err, messageId: message.id }, "Bot message handling failed");
    // Silent failure - no error message posted
  }
}

export async function startBotSubscription(): Promise<void> {
  log.info("Starting bot subscription");
  await subscribeToMessages(handleMessage);
  log.info("Bot subscription started");
}
