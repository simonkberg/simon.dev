import "server-only";
import { createHash } from "node:crypto";

import { log } from "@/lib/log";
import { query } from "@/lib/turso";

// Append only, and never edit an entry once applied: boot fails on a changed
// checksum. Each entry is one statement that must be safe to re-run, since a
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
  `CREATE TABLE IF NOT EXISTS rate_limits (key TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS rate_limits_key_expires_at ON rate_limits (key, expires_at)`,
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
    applied_at TEXT NOT NULL,
    checksum TEXT
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

function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

// Tables made before checksums were recorded lack the column.
async function addChecksumColumn(): Promise<void> {
  try {
    await query("SELECT checksum FROM migrations LIMIT 0");
  } catch (err) {
    // If the column was there after all, the probe's error is the real one.
    await query("ALTER TABLE migrations ADD COLUMN checksum TEXT").catch(() => {
      throw err;
    });
  }
}

async function verifyApplied(): Promise<Set<number>> {
  const { rows } = await query("SELECT version, checksum FROM migrations");
  const changed: number[] = [];

  const applied = new Set<number>();
  for (const row of rows) {
    const version = Number(row["version"]);
    applied.add(version);
    const sql = MIGRATIONS[version - 1];
    if (sql === undefined) continue;
    if (row["checksum"] === null) {
      await query("UPDATE migrations SET checksum = ? WHERE version = ?", [
        checksum(sql),
        version,
      ]);
    } else if (row["checksum"] !== checksum(sql)) {
      changed.push(version);
    }
  }

  if (changed.length > 0) {
    throw new Error(
      `Applied migrations were edited: ${changed.join(", ")}. Add a new migration instead.`,
    );
  }
  return applied;
}

async function applyPending(): Promise<void> {
  await addChecksumColumn();
  const applied = await verifyApplied();

  for (const [index, sql] of MIGRATIONS.entries()) {
    const version = index + 1;
    if (applied.has(version)) continue;

    await query(sql);
    await query(
      "INSERT INTO migrations (version, applied_at, checksum) VALUES (?, ?, ?)",
      [version, new Date().toISOString(), checksum(sql)],
    );
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
