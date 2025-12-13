// app/lib/discord/bot.ts
import "server-only";

import { createMessage } from "@/lib/anthropic";
import { log } from "@/lib/log";
import { getRedis } from "@/lib/redis";

import {
  BOT_USERNAME,
  getMessageChain,
  mentionsBot,
  postChannelMessage,
} from "./api";
import { subscribeToMessages } from "./gateway";

const SEEN_PREFIX = "discord:seen:";
const SEEN_TTL = 60;

async function markSeen(messageId: string): Promise<boolean> {
  const result = await getRedis().set(`${SEEN_PREFIX}${messageId}`, "1", {
    nx: true,
    ex: SEEN_TTL,
  });
  return result === "OK";
}

export async function handleMessage(messageId: string): Promise<void> {
  try {
    // Dedup across instances
    const isNew = await markSeen(messageId);
    if (!isNew) return;

    // Fetch the reply chain
    const chain = await getMessageChain(messageId);

    // Check if bot is mentioned anywhere in chain
    if (!chain.some((m) => mentionsBot(m.content))) return;

    // Build conversation for Anthropic
    const messages = chain.map((m) => ({
      role: m.isBot ? ("assistant" as const) : ("user" as const),
      username: m.username,
      content: m.content,
    }));

    // Generate and post response
    for await (const response of createMessage(messages)) {
      await postChannelMessage(response, BOT_USERNAME, messageId);
    }

    log.info({ messageId }, "Bot responded to message");
  } catch (err) {
    log.error({ err, messageId }, "Bot message handling failed");
    // Silent failure - no error message posted
  }
}

export async function startBotSubscription(): Promise<void> {
  log.info("Starting bot subscription");
  await subscribeToMessages(handleMessage);
  log.info("Bot subscription started");
}
