import "server-only";
import { type ChatMessage, createMessage } from "@/lib/anthropic";
import { log } from "@/lib/log";
import { getRedis } from "@/lib/redis";
import { reflect } from "@/lib/reflection";

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
  const messageId = message.id;
  try {
    // Only respond to default messages (0) and replies (19)
    if (message.type !== 0 && message.type !== 19) return;

    // Skip our own messages
    if (isBotMessage(message.content)) return;

    // Dedup across instances
    const isNew = await markSeen(messageId);
    if (!isNew) return;

    // Fetch the reply chain
    const chain = await getMessageChain(messageId);
    if (chain.length === 0) return;

    // Check if bot is mentioned anywhere in chain
    if (!chain.some((m) => mentionsBot(m.content))) return;

    // Past this point, we're committed to responding
    const messages = chain.map((m) => ({
      role:
        m.username === BOT_USERNAME
          ? ("assistant" as const)
          : ("user" as const),
      username: m.username,
      content: m.content,
    })) as [ChatMessage, ...ChatMessage[]];

    const replies: ChatMessage[] = [];
    try {
      for await (const response of createMessage(messages)) {
        await postChannelMessage(response, BOT_USERNAME, messageId);
        replies.push({
          role: "assistant",
          username: BOT_USERNAME,
          content: response,
        });
      }
      log.info({ messageId }, "Bot responded to message");
    } catch (err) {
      log.error({ err, messageId }, "Bot response failed");
      await postChannelMessage(
        "oops, something went wrong... try again later!",
        BOT_USERNAME,
        messageId,
      );
    } finally {
      // Not awaited: reflection must never delay or fail a reply, even a partial one.
      if (replies.length > 0) {
        reflect([...messages, ...replies]).catch((err) => {
          log.error({ err, messageId }, "Bot reflection failed");
        });
      }
    }
  } catch (err) {
    log.error({ err, messageId: messageId }, "Bot message handling failed");
  }
}

export async function startBotSubscription(): Promise<void> {
  log.info("Starting bot subscription");
  await subscribeToMessages(handleMessage);
  log.info("Bot subscription started");
}
