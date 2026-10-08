import "server-only";
import { log } from "@/lib/log";
import { query } from "@/lib/turso";

export type RateLimitResult =
  | { success: true }
  | { success: false; reset: number };

export type RateLimitOptions = { limit: number; windowMs: number };

// One statement, so SQLite's single writer makes the count and the insert
// atomic across replicas.
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
  return {
    success: false,
    reset: (typeof oldest === "number" ? oldest : now) + windowMs,
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
