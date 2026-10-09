"use server";

import { cacheLife, cacheTag, refresh, updateTag } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { setChatTipDismissed } from "@/lib/chatTip";
import {
  getChannelMessages,
  type Message,
  postChannelMessage,
} from "@/lib/discord/api";
import { identifiers } from "@/lib/identifiers";
import { log } from "@/lib/log";
import { pruneRateLimits, rateLimit } from "@/lib/rateLimit";
import { getSession } from "@/lib/session";

export type ChatHistoryResult =
  | { status: "ok"; messages: Message[] }
  | { status: "error"; error: string };

export async function getChatHistory(): Promise<ChatHistoryResult> {
  "use cache";
  cacheLife("seconds");
  cacheTag("getChatHistory");

  try {
    const messages = await getChannelMessages();
    return { status: "ok", messages };
  } catch (err) {
    log.error({ err, action: "getChatHistory" }, "Error fetching chat history");
    return { status: "error", error: "Failed to fetch chat history" };
  }
}

const RATE_LIMIT = { limit: 5, windowMs: 30_000 };

export async function refreshChatHistory() {
  updateTag("getChatHistory");
  refresh();
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
    const text = z.string().trim().min(1).parse(formData.get("text"));
    const replyToId = z
      .string()
      .optional()
      .parse(formData.get("replyToId") ?? undefined);

    const { username } = await getSession();

    const request = await identifiers();
    const identifier = request.ip ?? username;
    const limited = await rateLimit(
      `postChatMessage:${identifier}`,
      RATE_LIMIT,
    );

    after(() => pruneRateLimits(RATE_LIMIT.windowMs));

    if (!limited.success) {
      return {
        status: "error",
        error: `Rate limit exceeded. Wait ${limited.retryAfterSeconds} seconds before trying again.`,
      };
    }

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
