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

async function prune(windowMs: number): Promise<void> {
  try {
    await query("DELETE FROM rate_limits WHERE at <= ?", [
      Date.now() - windowMs,
    ]);
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
  const since = now - windowMs;

  const cached = blockedUntil().get(key);
  if (cached !== undefined && cached > now) return rejected(cached, now);

  try {
    // One statement, so SQLite's single writer makes count and insert atomic.
    const { rowsAffected } = await query(
      `INSERT INTO rate_limits (key, at)
       SELECT ?, ?
       WHERE (SELECT count(*) FROM rate_limits WHERE key = ? AND at > ?) < ?`,
      [key, now, key, since, limit],
    );
    if (rowsAffected > 0) {
      // Only inserts add rows, so only they need to clear out old ones.
      void prune(windowMs);
      return { success: true };
    }

    const { rows } = await query(
      "SELECT min(at) AS oldest FROM rate_limits WHERE key = ? AND at > ?",
      [key, since],
    );
    // No oldest means it left the window since the insert: retry now.
    const reset = Number(rows[0]?.["oldest"] ?? since) + windowMs;
    blockedUntil().set(key, reset);
    return rejected(reset, now);
  } catch (err) {
    log.warn({ err, key }, "Rate limiter failed");
    return { success: true };
  }
}
