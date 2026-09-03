import "server-only";
import { type ChatMessage, createMessage } from "@/lib/anthropic";
import { log } from "@/lib/log";
import {
  displayName,
  getProfile,
  HANDLE,
  lastKnownProfile,
  type Profile,
  selfNames,
} from "@/lib/profile";
import { getRedis } from "@/lib/redis";
import { reflect } from "@/lib/reflection";

import type { Username } from "../session";
import { getMessageChain, postChannelMessage } from "./api";
import { subscribeToMessages } from "./gateway";
import type { DiscordMessage } from "./schemas";

const HANDLE_PATTERN = /\bsimon[- ]?bot\b/i;

async function loadProfile(): Promise<Profile> {
  try {
    return await getProfile();
  } catch (err) {
    log.error(
      { err },
      "Failed to load the bot's profile, using the last known one",
    );
    return lastKnownProfile();
  }
}

function isOwnMessage(content: string, names: string[]): boolean {
  return names.some((name) => content.startsWith(`${name}: `));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionsName(content: string, name: string): boolean {
  // \b is ASCII-only, so use Unicode-aware boundaries for names like "José".
  const boundary = String.raw`[\p{L}\p{N}_]`;
  return new RegExp(
    `(?<!${boundary})${escapeRegExp(name)}(?!${boundary})`,
    "iu",
  ).test(content);
}

// Former names still work: the chat tip can lag a rename by a minute or so.
function mentionsBot(content: string, names: string[]): boolean {
  if (HANDLE_PATTERN.test(content)) return true;
  return names.some((name) => name !== HANDLE && mentionsName(content, name));
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

    // Our own messages need no lookups to skip
    if (isOwnMessage(message.content, selfNames(lastKnownProfile()))) return;

    // Dedup across instances
    const isNew = await markSeen(message.id);
    if (!isNew) return;

    const profile = await loadProfile();
    const names = selfNames(profile);
    if (isOwnMessage(message.content, names)) return;

    // Fetch the reply chain
    const chain = await getMessageChain(message.id);
    if (chain.length === 0) return;

    // Check if bot is mentioned anywhere in chain
    if (!chain.some((m) => mentionsBot(m.content, names))) return;

    // Past this point, we're committed to responding
    const messages = chain.map((m) => ({
      role: names.includes(m.username)
        ? ("assistant" as const)
        : ("user" as const),
      username: m.username,
      content: m.content,
    })) as [ChatMessage, ...ChatMessage[]];

    // The bot can rename itself mid-reply, so the name is read at each post.
    const currentName = () => displayName(lastKnownProfile()) as Username;
    const replies: ChatMessage[] = [];
    try {
      for await (const response of createMessage(messages)) {
        const name = currentName();
        await postChannelMessage(response, name, message.id);
        replies.push({ role: "assistant", username: name, content: response });
      }
      log.info({ messageId: message.id }, "Bot responded to message");
    } catch (err) {
      log.error({ err, messageId: message.id }, "Bot response failed");
      await postChannelMessage(
        "oops, something went wrong... try again later!",
        currentName(),
        message.id,
      );
    }

    // Deliberately not awaited: reflection must never delay or fail a reply.
    // A partial exchange still counts as long as the bot said something.
    if (replies.length > 0) {
      reflect([...messages, ...replies]).catch((err) => {
        log.error({ err, messageId: message.id }, "Bot reflection failed");
      });
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
