import "server-only";
import { networkOf } from "@/lib/identifiers";
import { log } from "@/lib/log";
import { query } from "@/lib/turso";

// A spammer that has posted the same Calendly link for months.
const SPAM = /calendly\.com\/melottogroup/i;

export function isSpam(text: string): boolean {
  return SPAM.test(text);
}

export async function ban(ip: string): Promise<void> {
  const network = networkOf(ip);
  await query(
    "INSERT INTO banned_networks (network, banned_at) VALUES (?, ?) ON CONFLICT DO NOTHING",
    [network, Date.now()],
  );
  log.info({ ip, network }, "Banned a network");
}

// Fails open, like the rate limiter.
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
