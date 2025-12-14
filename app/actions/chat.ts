"use server";

import { Ratelimit } from "@upstash/ratelimit";
import { cacheLife } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import {
  getChannelMessages,
  type Message,
  postChannelMessage,
} from "@/lib/discord/api";
import { identifiers } from "@/lib/identifiers";
import { log } from "@/lib/log";
import { getRedis } from "@/lib/redis";
import { getSession } from "@/lib/session";

export type ChatHistoryResult =
  | { status: "ok"; messages: Message[] }
  | { status: "error"; error: string };

export async function getChatHistory(): Promise<ChatHistoryResult> {
  "use cache";
  cacheLife("seconds");

  try {
    const messages = await getChannelMessages();
    return { status: "ok", messages };
  } catch (err) {
    log.error({ err, action: "getChatHistory" }, "Error fetching chat history");
    return { status: "error", error: "Failed to fetch chat history" };
  }
}

let rateLimiter: Ratelimit | undefined;

function getRateLimiter() {
  if (!rateLimiter) {
    rateLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(5, "30 s"),
      enableProtection: true,
      analytics: true,
      prefix: "postChatMessage",
    });
  }

  return rateLimiter;
}

export type PostChatMessageResult =
  | { status: "initial" }
  | { status: "ok" }
  | { status: "error"; error: string };

export async function postChatMessage(
  formData: FormData,
): Promise<PostChatMessageResult> {
  try {
    const text = z.string().parse(formData.get("text"));
    const replyToId = z
      .string()
      .optional()
      .parse(formData.get("replyToId") ?? undefined);

    const { username } = await getSession();

    const request = await identifiers();
    const identifier = request.ip ?? username;
    const { success, pending, reset } = await getRateLimiter().limit(
      identifier,
      request,
    );

    after(pending);

    if (!success) {
      return {
        status: "error",
        error: `Rate limit exceeded. Wait ${Math.ceil((reset - Date.now()) / 1000)} seconds before trying again.`,
      };
    }

    const messageId = await postChannelMessage(text, username, replyToId);

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
