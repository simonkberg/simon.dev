import "server-only";
import { getGlobal } from "@/lib/global";
import { log } from "@/lib/log";
import { query } from "@/lib/turso";

type RateLimitResult =
  | { success: true }
  | { success: false; retryAfterSeconds: number };

// Keys known to be over their limit, and when that lifts, so a flood from one
// key is turned away without a database round trip. Per process, best effort.
function blocked(): Map<string, number> {
  return getGlobal("simon.dev/rateLimit/blocked", () => new Map());
}

function rejected(reset: number, now: number): RateLimitResult {
  return {
    success: false,
    retryAfterSeconds: Math.max(1, Math.ceil((reset - now) / 1000)),
  };
}

function block(key: string, until: number, now: number): void {
  const map = blocked();
  for (const [other, otherUntil] of map) {
    if (otherUntil <= now) map.delete(other);
  }
  map.set(key, until);
}

// Fails open: the limiter being down shouldn't take its caller down with it.
export async function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  const now = Date.now();
  const since = now - windowMs;

  const blockedUntil = blocked().get(key);
  if (blockedUntil !== undefined && blockedUntil > now) {
    return rejected(blockedUntil, now);
  }

  try {
    // One statement, so SQLite's single writer makes count and insert atomic.
    const { rowsAffected } = await query(
      `INSERT INTO rate_limits (key, at)
       SELECT ?, ?
       WHERE (SELECT count(*) FROM rate_limits WHERE key = ? AND at > ?) < ?`,
      [key, now, key, since, limit],
    );
    if (rowsAffected > 0) return { success: true };

    const { rows } = await query(
      "SELECT min(at) AS oldest FROM rate_limits WHERE key = ? AND at > ?",
      [key, since],
    );
    // No oldest means it left the window since the insert: retry now.
    const reset = Number(rows[0]?.["oldest"] ?? since) + windowMs;
    block(key, reset, now);
    return rejected(reset, now);
  } catch (err) {
    log.warn({ err, key }, "Rate limiter failed");
    return { success: true };
  }
}

export async function pruneRateLimits(windowMs: number): Promise<void> {
  try {
    await query("DELETE FROM rate_limits WHERE at <= ?", [
      Date.now() - windowMs,
    ]);
  } catch (err) {
    log.warn({ err }, "Failed to prune rate limits");
  }
}
