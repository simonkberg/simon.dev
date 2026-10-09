import "server-only";
import { type ChatMessage, createMessage } from "@/lib/anthropic";
import { log } from "@/lib/log";
import { reflect } from "@/lib/reflection";
import { query } from "@/lib/turso";

import type { Username } from "../session";
import { getMessageChain, postChannelMessage } from "./api";
import { subscribeToMessages } from "./gateway";
import type { DiscordMessage } from "./schemas";

const BOT_USERNAME = "simon-bot" as Username;
const BOT_PREFIX = `${BOT_USERNAME}: `;
const BOT_MENTION_PATTERN = /\bsimon[- ]?bot\b/i;

function isBotMessage(content: string): boolean {
  return content.startsWith(BOT_PREFIX);
}

function mentionsBot(content: string): boolean {
  return BOT_MENTION_PATTERN.test(content);
}

// Outlasts any gateway replay of missed events after a reconnect.
const SEEN_RETENTION_MS = 60 * 60 * 1000;

async function pruneSeen(): Promise<void> {
  try {
    await query("DELETE FROM seen_messages WHERE at <= ?", [
      Date.now() - SEEN_RETENTION_MS,
    ]);
  } catch (err) {
    log.warn({ err }, "Failed to prune seen messages");
  }
}

async function markSeen(messageId: string): Promise<boolean> {
  const { rowsAffected } = await query(
    "INSERT OR IGNORE INTO seen_messages (id, at) VALUES (?, ?)",
    [messageId, Date.now()],
  );
  if (rowsAffected === 0) return false;
  void pruneSeen();
  return true;
}

export async function handleMessage(message: DiscordMessage): Promise<void> {
  const messageId = message.id;
  try {
    // Only respond to default messages (0) and replies (19)
    if (message.type !== 0 && message.type !== 19) return;

    if (isBotMessage(message.content)) return;

    // A message that isn't a reply can only involve the bot by mentioning it
    if (!message.message_reference && !mentionsBot(message.content)) return;

    const isNew = await markSeen(messageId);
    if (!isNew) {
      log.info({ messageId }, "Message already handled by another instance");
      return;
    }

    const chain = await getMessageChain(messageId);
    if (chain.length === 0) return;

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
    let finished = false;
    try {
      for await (const response of createMessage(messages)) {
        await postChannelMessage(response, BOT_USERNAME, messageId);
        replies.push({
          role: "assistant",
          username: BOT_USERNAME,
          content: response,
        });
      }
      finished = true;
      log.info(
        { messageId, replies: replies.length },
        replies.length > 0
          ? "Bot responded to message"
          : "Bot chose not to reply",
      );
    } catch (err) {
      log.error({ err, messageId }, "Bot response failed");
      await postChannelMessage(
        "oops, something went wrong... try again later!",
        BOT_USERNAME,
        messageId,
      );
    } finally {
      // Not awaited: reflection must never delay or fail a reply, even a partial one.
      // Staying silent is still a turn worth reflecting on; a turn that failed before
      // anything was said is not.
      if (finished || replies.length > 0) {
        reflect([...messages, ...replies]).catch((err) => {
          log.error({ err, messageId }, "Bot reflection failed");
        });
      }
    }
  } catch (err) {
    log.error({ err, messageId }, "Bot message handling failed");
  }
}

export async function startBotSubscription(): Promise<void> {
  log.info("Starting bot subscription");
  await subscribeToMessages(handleMessage);
  log.info("Bot subscription started");
}
