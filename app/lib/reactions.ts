import "server-only";
import { z } from "zod";

import {
  addBotReaction,
  type Message,
  type Reaction,
  removeBotReaction,
} from "@/lib/discord/api";
import { RGI_EMOJI, withoutSkinTone } from "@/lib/emoji";
import { log } from "@/lib/log";
import type { Username } from "@/lib/session";
import { flag } from "@/lib/sql";
import { batch, query } from "@/lib/turso";

/** One emoji as Discord stores a reaction's name. */
export const EmojiSchema = z.string().regex(RGI_EMOJI);
// Discord snowflakes, at most 20 digits.
export const MessageIdSchema = z.string().max(20).regex(/^\d+$/);

const DELETE_ROW =
  "DELETE FROM reactions WHERE message_id = ? AND emoji = ? AND username = ?";

/** Adds the visitor's reaction, or takes it back if they already reacted with that emoji. */
export async function toggleReaction(
  messageId: string,
  emoji: string,
  username: Username,
): Promise<"added" | "removed"> {
  if (await removeReaction(messageId, emoji, username)) return "removed";
  await addReaction(messageId, emoji, username);
  return "added";
}

const foundSchema = z.object({ found: flag });
const emojiSchema = z.object({ emoji: z.string() });
const reactionSchema = z.object({
  message_id: z.string(),
  emoji: z.string(),
  username: z.string(),
});

async function removeReaction(
  messageId: string,
  emoji: string,
  username: Username,
): Promise<boolean> {
  // The count rides along when nothing was deleted too, saving a removal a round trip.
  const [{ rowsAffected }, { rows: remaining }] = await batch([
    { sql: DELETE_ROW, args: [messageId, emoji, username] },
    {
      sql: "SELECT EXISTS (SELECT 1 FROM reactions WHERE message_id = ? AND emoji = ?) AS found",
      args: [messageId, emoji],
      rows: foundSchema,
    },
  ]);
  if (rowsAffected === 0) return false;
  if (!remaining[0]?.found) {
    // The site counts from Turso, so a stale mirror only shows on Discord.
    await removeBotReaction(messageId, emoji).catch((err: unknown) => {
      log.warn({ err, messageId, emoji }, "Failed to remove bot reaction");
    });
  }
  return true;
}

/** Adds a reaction, mirroring it on Discord once. */
export async function addReaction(
  messageId: string,
  emoji: string,
  username: Username,
): Promise<void> {
  // The row goes in first so a concurrent removal counts it and keeps the mirror.
  const inserted = await query({
    sql: "INSERT INTO reactions (message_id, emoji, username) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    args: [messageId, emoji, username],
  });
  if (inserted.rowsAffected > 0) {
    try {
      // Discord turns away a message or emoji it doesn't know.
      await addBotReaction(messageId, emoji);
    } catch (err) {
      // Discord's error is the one the visitor needs, so a failed rollback only logs.
      await query({
        sql: DELETE_ROW,
        args: [messageId, emoji, username],
      }).catch((rollbackErr: unknown) =>
        log.warn(
          { err: rollbackErr, messageId, emoji },
          "Failed to roll back reaction",
        ),
      );
      throw err;
    }
  }
  // One tone per emoji: drop the user's others once this one is in.
  await removeOtherTones(messageId, emoji, username).catch((err: unknown) => {
    log.warn({ err, messageId, emoji }, "Failed to replace other tones");
  });
}

async function removeOtherTones(
  messageId: string,
  emoji: string,
  username: Username,
): Promise<void> {
  const base = withoutSkinTone(emoji);
  const { rows } = await query({
    sql: "SELECT emoji FROM reactions WHERE message_id = ? AND username = ? AND emoji != ?",
    args: [messageId, username, emoji],
    rows: emojiSchema,
  });
  for (const { emoji: other } of rows) {
    if (withoutSkinTone(other) === base) {
      await removeReaction(messageId, other, username);
    }
  }
}

type Reactable<T> = { id: string; reactions: Reaction[]; replies?: T[] };
type SiteReactions = Map<string, Map<string, string[]>>;

function collectIds<T extends Reactable<T>>(
  items: T[],
  ids: string[] = [],
): string[] {
  for (const item of items) {
    ids.push(item.id);
    collectIds(item.replies ?? [], ids);
  }
  return ids;
}

function mergeReactions<T extends Reactable<T>>(
  items: T[],
  site: SiteReactions,
): T[] {
  return items.map((item) => {
    const users = new Map(site.get(item.id));
    const reactions: Reaction[] = item.reactions.map((reaction) => {
      const siteUsers = users.get(reaction.emoji) ?? [];
      users.delete(reaction.emoji);
      return {
        ...reaction,
        count: reaction.count + siteUsers.length,
        users: [...reaction.users, ...siteUsers],
      };
    });
    for (const [emoji, siteUsers] of users) {
      reactions.push({ emoji, count: siteUsers.length, users: siteUsers });
    }
    return item.replies
      ? { ...item, reactions, replies: mergeReactions(item.replies, site) }
      : { ...item, reactions };
  });
}

/** Marks the visitor's own reactions, which the shared, cached history can't know. */
export function markOwnReactions(
  messages: Message[],
  username: string,
): Message[] {
  return messages.map((message) => {
    const reactions = message.reactions.map((reaction) =>
      reaction.users.includes(username)
        ? {
            ...reaction,
            mine: true,
            users: reaction.users.filter((user) => user !== username),
          }
        : reaction,
    );
    return {
      ...message,
      reactions,
      replies: markOwnReactions(message.replies, username),
    };
  });
}

/** Adds the site's reactions to the Discord ones; on failure the Discord ones still show. */
export async function withSiteReactions<T extends Reactable<T>>(
  items: T[],
): Promise<T[]> {
  const ids = collectIds(items);
  if (ids.length === 0) return items;

  try {
    const { rows } = await query({
      sql: `SELECT message_id, emoji, username FROM reactions
       WHERE message_id IN (SELECT value FROM json_each(?))
       ORDER BY id`,
      args: [JSON.stringify(ids)],
      rows: reactionSchema,
    });

    const site: SiteReactions = new Map();
    for (const { message_id: messageId, emoji, username } of rows) {
      const byEmoji = site.get(messageId) ?? new Map<string, string[]>();
      site.set(messageId, byEmoji);
      const users = byEmoji.get(emoji) ?? [];
      byEmoji.set(emoji, users);
      users.push(username);
    }

    return mergeReactions(items, site);
  } catch (err) {
    log.error({ err }, "Failed to load reactions");
    return items;
  }
}
