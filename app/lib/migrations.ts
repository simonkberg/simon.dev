import "server-only";
import { log } from "@/lib/log";
import { query } from "@/lib/turso";

// Append only. Each entry is one statement that must be safe to re-run: a
// crash between applying and recording it re-applies it on the next boot.
export const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS memories_category ON memories (category)`,
  `CREATE TABLE IF NOT EXISTS seen_messages (id TEXT PRIMARY KEY, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (key TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS rate_limits_key_at ON rate_limits (key, at)`,
];

// Outside MIGRATIONS: the lock and the version list need these before it can run.
const BOOTSTRAP = [
  `CREATE TABLE IF NOT EXISTS locks (
    name TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
];

const LOCK_NAME = "migrations";
const LOCK_TTL_MS = 30_000;
const LOCK_RETRY_MS = 500;
// Longer than the lease, so a holder that died is outwaited.
const LOCK_WAIT_MS = 45_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function acquireLock(owner: string): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const now = Date.now();
    try {
      // Matching our own owner makes a retry after a lost response succeed.
      const { rowsAffected } = await query(
        `INSERT INTO locks (name, owner, expires_at) VALUES (?, ?, ?)
         ON CONFLICT (name) DO UPDATE
         SET owner = excluded.owner, expires_at = excluded.expires_at
         WHERE locks.expires_at < ? OR locks.owner = excluded.owner`,
        [LOCK_NAME, owner, now + LOCK_TTL_MS, now],
      );
      if (rowsAffected > 0) return;
    } catch (err) {
      lastError = err;
      log.warn({ err }, "Failed to take the migrations lock, retrying");
    }
    await sleep(LOCK_RETRY_MS);
  }
  throw new Error("Timed out waiting for the migrations lock", {
    cause: lastError,
  });
}

async function applyPending(): Promise<void> {
  const { rows } = await query("SELECT version FROM migrations");
  const applied = new Set(rows.map((row) => row["version"]));

  for (const [index, sql] of MIGRATIONS.entries()) {
    const version = index + 1;
    if (applied.has(version)) continue;

    await query(sql);
    await query("INSERT INTO migrations (version, applied_at) VALUES (?, ?)", [
      version,
      new Date().toISOString(),
    ]);
    log.info({ version }, "Applied migration");
  }
}

export async function runMigrations(): Promise<void> {
  for (const sql of BOOTSTRAP) await query(sql);
  const owner = crypto.randomUUID();
  await acquireLock(owner);
  try {
    await applyPending();
  } finally {
    await query("DELETE FROM locks WHERE name = ? AND owner = ?", [
      LOCK_NAME,
      owner,
    ]).catch((err: unknown) => {
      log.warn({ err }, "Failed to release the migrations lock");
    });
  }
}
