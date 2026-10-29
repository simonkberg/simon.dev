import "server-only";
import { networkOf } from "@/lib/identifiers";
import { log } from "@/lib/log";
import type { Username } from "@/lib/session";
import { batch, query } from "@/lib/turso";

// A spammer that has posted the same Calendly link for months.
const SPAM = /calendly\.com\/melottogroup/i;

export function isSpam(text: string): boolean {
  return SPAM.test(text);
}

async function insertBan(network: string): Promise<void> {
  await query(
    "INSERT INTO banned_networks (network, banned_at) VALUES (?, ?) ON CONFLICT DO NOTHING",
    [network, Date.now()],
  );
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

export async function isBanned(ip: string): Promise<boolean> {
  try {
    const { rows } = await query(
      "SELECT 1 FROM banned_networks WHERE network = ?",
      [networkOf(ip)],
    );
    if (rows.length === 0) return false;
    log.info({ ip }, "Turned away a banned network");
    return true;
  } catch (err) {
    log.warn({ err, ip }, "Failed to check for a ban");
    return false;
  }
}

/** Bans the network a site post came from, returning its author; undefined for a post it has no IP for. */
export async function banPost(messageId: string): Promise<string | undefined> {
  const { rows } = await query(
    "SELECT username, ip FROM chat_posts WHERE message_id = ?",
    [messageId],
  );
  const username = rows[0]?.["username"];
  const ip = rows[0]?.["ip"];
  if (typeof username !== "string" || typeof ip !== "string") return undefined;
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
