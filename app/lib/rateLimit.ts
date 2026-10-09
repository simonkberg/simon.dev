import "server-only";
import { log } from "@/lib/log";
import { query } from "@/lib/turso";

type RateLimitResult =
  | { success: true }
  | { success: false; retryAfterSeconds: number };

// Fails open: the limiter being down shouldn't take its caller down with it.
export async function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  const now = Date.now();
  const since = now - windowMs;

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
    return {
      success: false,
      retryAfterSeconds: Math.max(1, Math.ceil((reset - now) / 1000)),
    };
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
