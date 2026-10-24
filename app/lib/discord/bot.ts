import "server-only";
import { BOT_USERNAME, type ChatMessage, createMessage } from "@/lib/anthropic";
import { log } from "@/lib/log";
import { withSiteReactions } from "@/lib/reactions";
import { reflect } from "@/lib/reflection";
import { query } from "@/lib/turso";

import {
  type ChainMessage,
  getMessageChain,
  isOwnPost,
  postChannelMessage,
  postedIn,
  sendTyping,
} from "./api";
import { subscribe } from "./gateway";
import { type DiscordMessage, isShown, parentId } from "./schemas";

const BOT_PREFIX = `${BOT_USERNAME}: `;
const BOT_MENTION_PATTERN = /\bsimon[- ]?bot\b/i;

function isBotMessage(content: string): boolean {
  return content.startsWith(BOT_PREFIX);
}

function mentionsBot(content: string): boolean {
  return BOT_MENTION_PATTERN.test(content);
}

// Within Discord's 10s, so the indicator doesn't flicker off between calls.
const TYPING_INTERVAL_MS = 8_000;

// One call at a time: typing that lands after a post shows the bot typing again for 10s.
function keepTyping() {
  let typing = true;
  let timer: NodeJS.Timeout | undefined;
  let sent = Promise.resolve();
  const type = () => {
    sent = sendTyping()
      .catch((err: unknown) => {
        log.warn({ err }, "Failed to show the bot typing");
      })
      .then(() => {
        if (typing) timer = setTimeout(type, TYPING_INTERVAL_MS);
      });
  };
  const stop = () => {
    typing = false;
    clearTimeout(timer);
    return sent;
  };
  type();
  return {
    async pause<T>(post: () => Promise<T>): Promise<T> {
      await stop();
      try {
        return await post();
      } finally {
        typing = true;
        timer = setTimeout(type, TYPING_INTERVAL_MS);
      }
    },
    stop,
  };
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

async function toChatMessages(
  chain: ChainMessage[],
): Promise<[ChatMessage, ...ChatMessage[]]> {
  return (await withSiteReactions(chain)).map((m) => ({
    role:
      m.username === BOT_USERNAME ? ("assistant" as const) : ("user" as const),
    id: m.id,
    username: m.username,
    content: m.content,
    reactions: m.reactions,
  })) as [ChatMessage, ...ChatMessage[]];
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
    if (!isShown(message)) return;

    if (isBotMessage(message.content)) return;

    // A message that isn't a reply can only involve the bot by mentioning it
    if (!parentId(message) && !mentionsBot(message.content)) return;

    // Site posts come from every environment on the channel; each answers its own.
    if (message.author.bot && !isOwnPost(message)) {
      log.info({ messageId }, "Site post from another environment");
      return;
    }

    const isNew = await markSeen(messageId);
    if (!isNew) {
      log.info({ messageId }, "Message already handled by another instance");
      return;
    }

    const chain = await getMessageChain(messageId);
    if (chain.length === 0) return;

    if (!message.author.bot && !(await postedIn(chain))) {
      log.info({ messageId }, "Discord thread from another environment");
      return;
    }

    if (!chain.some((m) => mentionsBot(m.content))) return;

    // Past this point, we're committed to responding
    const messages = await toChatMessages(chain);

    const replies: ChatMessage[] = [];
    let finished = false;
    const typing = keepTyping();
    try {
      for await (const response of createMessage(messages)) {
        await typing.pause(() =>
          postChannelMessage(response, BOT_USERNAME, messageId),
        );
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
      await typing.pause(() =>
        postChannelMessage(
          "oops, something went wrong... try again later!",
          BOT_USERNAME,
          messageId,
        ),
      );
    } finally {
      void typing.stop();
      // Not awaited: reflection must never delay or fail a reply, even a partial one.
      // Staying silent is still a turn worth reflecting on; a turn that failed before
      // anything was said is not.
      if (finished || replies.length > 0) {
        // The site's reactions again, so reflection sees the bot's from this turn.
        toChatMessages(chain)
          .then((transcript) => reflect([...transcript, ...replies]))
          .catch((err) => {
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
  await subscribe((event) => {
    if (event.t === "MESSAGE_CREATE") void handleMessage(event.d);
  });
  log.info("Bot subscription started");
}
