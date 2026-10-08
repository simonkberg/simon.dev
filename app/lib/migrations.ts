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
  `CREATE TABLE IF NOT EXISTS seen_messages (id TEXT PRIMARY KEY)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (key TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS rate_limits_key_at ON rate_limits (key, at)`,
];

const LOCK_NAME = "migrations";
const LOCK_TTL_MS = 60_000;
const LOCK_RETRY_MS = 500;
const LOCK_ATTEMPTS = 60;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function acquireLock(owner: string): Promise<void> {
  await query(
    `CREATE TABLE IF NOT EXISTS locks (
      name TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )`,
  );
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    const now = Date.now();
    const { rowsAffected } = await query(
      `INSERT INTO locks (name, owner, expires_at) VALUES (?, ?, ?)
       ON CONFLICT (name) DO UPDATE
       SET owner = excluded.owner, expires_at = excluded.expires_at
       WHERE locks.expires_at < ?`,
      [LOCK_NAME, owner, now + LOCK_TTL_MS, now],
    );
    if (rowsAffected > 0) return;
    await sleep(LOCK_RETRY_MS);
  }
  throw new Error("Timed out waiting for the migrations lock");
}

async function applyPending(): Promise<void> {
  await query(
    `CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`,
  );
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
  const owner = crypto.randomUUID();
  await acquireLock(owner);
  try {
    await applyPending();
  } finally {
    await query("DELETE FROM locks WHERE name = ? AND owner = ?", [
      LOCK_NAME,
      owner,
    ]);
  }
}
