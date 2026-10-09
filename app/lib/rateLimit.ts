import "server-only";
import { getGlobal } from "@/lib/global";
import { log } from "@/lib/log";
import { LruMap } from "@/lib/LruMap";
import { query } from "@/lib/turso";

type RateLimitResult =
  | { success: true }
  | { success: false; retryAfterSeconds: number };

const KEY = "simon.dev/rate-limit-blocked";

// Per-process cache of over-limit keys, so a flood skips the database.
function blockedUntil(): LruMap<string, number> {
  return getGlobal(KEY, () => new LruMap(1000));
}

function rejected(reset: number, now: number): RateLimitResult {
  return {
    success: false,
    retryAfterSeconds: Math.max(1, Math.ceil((reset - now) / 1000)),
  };
}

// Each row carries its own expiry, so one prune is right for every window.
async function prune(): Promise<void> {
  try {
    await query("DELETE FROM rate_limits WHERE expires_at <= ?", [Date.now()]);
  } catch (err) {
    log.warn({ err }, "Failed to prune rate limits");
  }
}

// Fails open: the limiter being down shouldn't take its caller down with it.
export async function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  const now = Date.now();

  const cached = blockedUntil().get(key);
  if (cached !== undefined && cached > now) return rejected(cached, now);

  try {
    // One statement, so SQLite's single writer makes count and insert atomic.
    const { rowsAffected } = await query(
      `INSERT INTO rate_limits (key, expires_at)
       SELECT ?, ?
       WHERE (SELECT count(*) FROM rate_limits WHERE key = ? AND expires_at > ?) < ?`,
      [key, now + windowMs, key, now, limit],
    );
    if (rowsAffected > 0) {
      // Only inserts add rows, so only they need to clear out old ones.
      void prune();
      return { success: true };
    }

    const { rows } = await query(
      "SELECT min(expires_at) AS reset FROM rate_limits WHERE key = ? AND expires_at > ?",
      [key, now],
    );
    // No row means the oldest expired since the insert: retry now.
    const reset = Number(rows[0]?.["reset"] ?? now);
    blockedUntil().set(key, reset);
    return rejected(reset, now);
  } catch (err) {
    log.warn({ err, key }, "Rate limiter failed");
    return { success: true };
  }
}
