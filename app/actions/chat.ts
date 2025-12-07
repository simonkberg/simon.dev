"use server";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { cacheLife } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { createMessage } from "@/lib/anthropic";
import {
  getChannelMessages,
  type Message,
  postChannelMessage,
} from "@/lib/discord/api";
import { identifiers } from "@/lib/identifiers";
import { log } from "@/lib/log";
import { getSession, type Username } from "@/lib/session";

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

const BOT_USERNAME = "simon-bot" as Username;
const SIMON_BOT_TRIGGER = /\bsimon[- ]?bot\b/i;

let rateLimiter: Ratelimit | undefined;

function getRateLimiter() {
  if (!rateLimiter) {
    rateLimiter = new Ratelimit({
      redis: Redis.fromEnv(),
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

    const messageId = await postChannelMessage(text, username);

    log.info(
      { username, messageId, ip: request.ip, action: "postChatMessage" },
      text,
    );

    if (SIMON_BOT_TRIGGER.test(text)) {
      after(botResponse(text, username, messageId));
    }

    return { status: "ok" };
  } catch (err) {
    log.error({ err, action: "postChatMessage" }, "Error posting chat message");
    return { status: "error", error: "Failed to post chat message" };
  }
}

async function botResponse(text: string, username: string, messageId: string) {
  try {
    const botResponse = await createMessage(text);
    await postChannelMessage(botResponse, BOT_USERNAME, messageId);
    log.info(
      { username, trigger: "simon-bot", action: "botResponse" },
      botResponse,
    );
  } catch (err) {
    log.error({ err, username, action: "botResponse" }, "Bot error");

    try {
      await postChannelMessage(
        "Sorry, I couldn't process that right now.",
        BOT_USERNAME,
        messageId,
      );
    } catch (postErr) {
      log.error(
        { err: postErr, action: "botErrorReply" },
        "Failed to post error reply",
      );
    }
  }
}
