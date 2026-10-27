import "server-only";
import { query } from "@/lib/turso";

/** Takes the lock, or extends it for its owner, unless someone else holds an unexpired one. */
export async function tryLock(
  name: string,
  owner: string,
  ttlMs: number,
): Promise<boolean> {
  const now = Date.now();
  // Matching our own owner makes a retry after a lost response succeed.
  const { rowsAffected } = await query(
    `INSERT INTO locks (name, owner, expires_at) VALUES (?, ?, ?)
     ON CONFLICT (name) DO UPDATE
     SET owner = excluded.owner, expires_at = excluded.expires_at
     WHERE locks.expires_at < ? OR locks.owner = excluded.owner`,
    [name, owner, now + ttlMs, now],
  );
  return rowsAffected > 0;
}

export async function releaseLock(name: string, owner: string): Promise<void> {
  await query("DELETE FROM locks WHERE name = ? AND owner = ?", [name, owner]);
}
