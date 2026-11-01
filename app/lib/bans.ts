import "server-only";
import { z } from "zod";

import { networkOf } from "@/lib/identifiers";
import { log } from "@/lib/log";
import type { Username } from "@/lib/session";
import { flag } from "@/lib/sql";
import { batch, query } from "@/lib/turso";

// A spammer that has posted the same Calendly link for months.
const SPAM = /calendly\.com\/melottogroup/i;

export function isSpam(text: string): boolean {
  return SPAM.test(text);
}

async function insertBan(network: string): Promise<void> {
  await query({
    sql: "INSERT INTO banned_networks (network, banned_at) VALUES (?, ?) ON CONFLICT DO NOTHING",
    args: [network, Date.now()],
  });
}

// Both fail open, like the rate limiter: the spam itself is turned away regardless.
export async function ban(ip: string): Promise<void> {
  const network = networkOf(ip);
  try {
    await insertBan(network);
    log.info({ ip, network }, "Banned a network");
  } catch (err) {
    log.warn({ err, ip, network }, "Failed to ban a network");
  }
}

const bannedSchema = z.object({ banned: flag });

export async function isBanned(ip: string): Promise<boolean> {
  try {
    const { rows } = await query({
      sql: "SELECT EXISTS (SELECT 1 FROM banned_networks WHERE network = ?) AS banned",
      args: [networkOf(ip)],
      rows: bannedSchema,
    });
    if (!rows[0]?.banned) return false;
    log.info({ ip }, "Turned away a banned network");
    return true;
  } catch (err) {
    log.warn({ err, ip }, "Failed to check for a ban");
    return false;
  }
}

const postSchema = z.object({ username: z.string(), ip: z.string() });

/** Bans the network a site post came from, returning its author; undefined for a post it has no IP for. */
export async function banPost(messageId: string): Promise<string | undefined> {
  const { rows } = await query({
    sql: "SELECT username, ip FROM chat_posts WHERE message_id = ?",
    args: [messageId],
    rows: postSchema,
  });
  const [post] = rows;
  if (post === undefined) return undefined;
  const { username, ip } = post;
  const network = networkOf(ip);
  await insertBan(network);
  log.info({ messageId, username, ip, network }, "Banned a post's network");
  return username;
}

const POST_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Never throws, since the post has already landed. */
export async function recordPost(
  messageId: string,
  username: Username,
  ip: string,
): Promise<void> {
  const now = Date.now();
  try {
    await batch([
      {
        sql: "INSERT INTO chat_posts (message_id, username, ip, posted_at) VALUES (?, ?, ?, ?)",
        args: [messageId, username, ip, now],
      },
      {
        sql: "DELETE FROM chat_posts WHERE posted_at <= ?",
        args: [now - POST_RETENTION_MS],
      },
    ]);
  } catch (err) {
    log.warn({ err, messageId }, "Failed to record a chat post");
  }
}
