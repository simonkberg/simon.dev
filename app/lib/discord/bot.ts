import "server-only";
import { type ChatMessage, createMessage } from "@/lib/anthropic";
import { log } from "@/lib/log";
import { getProfile } from "@/lib/profile";
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

const NAME_CACHE_TTL_MS = 60_000;
let cachedName: { value: string; expires: number } | undefined;

async function getChosenName(): Promise<string> {
  if (cachedName && cachedName.expires > Date.now()) return cachedName.value;
  try {
    const { name } = await getProfile();
    cachedName = { value: name, expires: Date.now() + NAME_CACHE_TTL_MS };
  } catch (err) {
    log.error({ err }, "Failed to load the bot's chosen name");
    cachedName = { value: "", expires: Date.now() + NAME_CACHE_TTL_MS };
  }
  return cachedName.value;
}

export function _resetNameCache(): void {
  cachedName = undefined;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionsBot(content: string, chosenName: string): boolean {
  if (BOT_MENTION_PATTERN.test(content)) return true;
  if (!chosenName) return false;
  return new RegExp(`\\b${escapeRegExp(chosenName)}\\b`, "i").test(content);
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
    const chosenName = await getChosenName();
    if (!chain.some((m) => mentionsBot(m.content, chosenName))) return;

    // Past this point, we're committed to responding
    const messages = chain.map((m) => ({
      role:
        m.username === BOT_USERNAME
          ? ("assistant" as const)
          : ("user" as const),
      username: m.username,
      content: m.content,
      owner: m.fromOwner,
    })) as [ChatMessage, ...ChatMessage[]];

    try {
      const replies: string[] = [];
      for await (const response of createMessage(messages)) {
        await postChannelMessage(response, BOT_USERNAME, message.id);
        replies.push(response);
      }
      log.info({ messageId: message.id }, "Bot responded to message");

      // Deliberately not awaited: reflection must never delay or fail a reply.
      reflect(messages, replies).catch((err) => {
        log.error({ err, messageId: message.id }, "Bot reflection failed");
      });
    } catch (err) {
      log.error({ err, messageId: message.id }, "Bot response failed");
      await postChannelMessage(
        "oops, something went wrong... try again later!",
        BOT_USERNAME,
        message.id,
      );
    }
  } catch (err) {
    log.error({ err, messageId: message.id }, "Bot message handling failed");
  }
}

export async function startBotSubscription(): Promise<void> {
  log.info("Starting bot subscription");
  await subscribeToMessages(handleMessage);
  log.info("Bot subscription started");
}
