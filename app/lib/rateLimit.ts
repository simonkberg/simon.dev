import "server-only";
import { log } from "@/lib/log";
import { query } from "@/lib/turso";

export type RateLimitResult =
  | { success: true }
  | { success: false; reset: number };

export type RateLimitOptions = { limit: number; windowMs: number };

// One statement, so SQLite's single writer makes count and insert atomic.
export async function rateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions,
): Promise<RateLimitResult> {
  const now = Date.now();
  const since = now - windowMs;

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
  const oldest = rows[0]?.["oldest"];
  // No oldest means it left the window since the insert: retry now.
  return {
    success: false,
    reset: typeof oldest === "number" ? oldest + windowMs : now,
  };
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
