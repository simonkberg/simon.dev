"use server";

import { cacheLife, cacheTag, refresh, updateTag } from "next/cache";
import { z } from "zod";

import { setChatTipDismissed } from "@/lib/chatTip";
import {
  DiscordApiError,
  getChannelMessages,
  getChannelRevision,
  type Message,
  postChannelMessage,
} from "@/lib/discord/api";
import { identifiers, networkOf } from "@/lib/identifiers";
import { isDeniedIp } from "@/lib/ipDenyList";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/rateLimit";
import {
  EmojiSchema,
  MessageIdSchema,
  toggleReaction,
  withSiteReactions,
} from "@/lib/reactions";
import { getSession, type Username } from "@/lib/session";

const MAX_MESSAGE_LENGTH = 500;

export type ChatHistoryResult =
  | { status: "ok"; messages: Message[] }
  | { status: "error"; error: string };

export async function getChatHistory(): Promise<ChatHistoryResult> {
  return getChatHistoryAt(getChannelRevision());
}

// Keyed on the revision, so every render between two changes shares one.
async function getChatHistoryAt(_revision: number): Promise<ChatHistoryResult> {
  "use cache";
  cacheTag("getChatHistory");

  try {
    const messages = await withSiteReactions(await getChannelMessages());
    // Bounds a lookup that failed or a bot reaction no event announced.
    cacheLife("minutes");
    return { status: "ok", messages };
  } catch (err) {
    log.error({ err, action: "getChatHistory" }, "Error fetching chat history");
    cacheLife("seconds");
    return { status: "error", error: "Failed to fetch chat history" };
  }
}

const RATE_LIMIT = { limit: 5, windowMs: 30_000 };

async function admit(
  action: string,
  verb: string,
  ip: string | undefined,
  username: Username,
  limits: { limit: number; windowMs: number },
): Promise<{ status: "error"; error: string } | null> {
  if (ip !== undefined && isDeniedIp(ip)) {
    log.info({ ip, action }, "Denied a listed IP");
    return { status: "error", error: `${verb} from your network is blocked.` };
  }

  const subject = ip === undefined ? username : networkOf(ip);
  const result = await rateLimit(`${action}:${subject}`, limits);
  if (!result.success) {
    return {
      status: "error",
      error: `Rate limit exceeded. Wait ${result.retryAfterSeconds} seconds before trying again.`,
    };
  }
  return null;
}

export async function dismissChatTip() {
  await setChatTipDismissed();
}

export type PostChatMessageResult =
  | { status: "initial" }
  | { status: "ok" }
  | { status: "error"; error: string };

export async function postChatMessage(
  formData: FormData,
): Promise<PostChatMessageResult> {
  try {
    const { username } = await getSession();

    // Admitted first, so malformed requests count against the limit too.
    const request = await identifiers();
    const denied = await admit(
      "postChatMessage",
      "Posting",
      request.ip,
      username,
      RATE_LIMIT,
    );
    if (denied) return denied;

    const text = z.string().trim().min(1).parse(formData.get("text"));
    if (text.length > MAX_MESSAGE_LENGTH) {
      return {
        status: "error",
        error: `Messages can be at most ${MAX_MESSAGE_LENGTH} characters long.`,
      };
    }
    const replyToId = z
      .string()
      .optional()
      .parse(formData.get("replyToId") ?? undefined);

    const messageId = await postChannelMessage(text, username, replyToId);

    await dismissChatTip();

    log.info(
      { username, messageId, ip: request.ip, action: "postChatMessage" },
      text,
    );

    return { status: "ok" };
  } catch (err) {
    log.error({ err, action: "postChatMessage" }, "Error posting chat message");
    return { status: "error", error: "Failed to post chat message" };
  }
}

// Each click counts, and trying a few emoji on and off is quick.
const REACTION_RATE_LIMIT = { limit: 30, windowMs: 60_000 };
// Discord's "Maximum number of reactions reached (20)".
const MAX_REACTIONS_CODE = 30010;

export type ReactToChatMessageResult =
  | { status: "ok" }
  | { status: "error"; error: string };

export async function reactToChatMessage(
  messageId: string,
  emoji: string,
): Promise<ReactToChatMessageResult> {
  try {
    const { username } = await getSession();

    const { ip } = await identifiers();
    const denied = await admit(
      "reactToChatMessage",
      "Reacting",
      ip,
      username,
      REACTION_RATE_LIMIT,
    );
    if (denied) return denied;

    const id = MessageIdSchema.parse(messageId);
    const reaction = EmojiSchema.parse(emoji);

    const change = await toggleReaction(id, reaction, username);
    log.info(
      {
        username,
        messageId: id,
        emoji: reaction,
        change,
        action: "reactToChatMessage",
      },
      "Toggled reaction",
    );

    updateTag("getChatHistory");
    refresh();
    return { status: "ok" };
  } catch (err) {
    if (err instanceof DiscordApiError && err.code === MAX_REACTIONS_CODE) {
      return { status: "error", error: "Discord allows 20 emoji per message" };
    }
    log.error(
      { err, action: "reactToChatMessage" },
      "Error reacting to chat message",
    );
    return { status: "error", error: "Failed to react to chat message" };
  }
}
