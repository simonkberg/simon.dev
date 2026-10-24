import "server-only";
import { createHash } from "node:crypto";

import { log } from "@/lib/log";
import { batch, query } from "@/lib/turso";

// Append only, and never edit an entry once applied: boot fails on a changed
// checksum. Each entry is one statement, applied and recorded in one transaction.
// Inside a transaction, so PRAGMA, VACUUM and multi-statement strings don't belong here.
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
  `CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY,
    message_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    username TEXT NOT NULL,
    UNIQUE (message_id, emoji, username)
  )`,
  // Backfills toOneLine in memory.ts; trim() strips the space an edge U+0085 becomes.
  `UPDATE memories SET content = trim(
    replace(replace(replace(replace(replace(replace(replace(replace(content,
      char(13, 10), ' '), char(13), ' '), char(10), ' '), char(11), ' '),
      char(12), ' '), char(133), ' '), char(8232), ' '), char(8233), ' ')
  )`,
  // A note that was only U+0085 is now empty, which contentSchema never writes.
  `DELETE FROM memories WHERE content = ''`,
  `CREATE TABLE IF NOT EXISTS presence (username TEXT PRIMARY KEY, seen_at INTEGER NOT NULL)`,
  // One row per stream rather than per visitor, so closing a tab can't drop their others.
  `DROP TABLE presence`,
  `CREATE TABLE presence (
    stream TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    seen_at INTEGER NOT NULL
  )`,
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
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

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
    // Applied before checksums existed: today's text becomes the baseline.
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

    await batch([
      { sql },
      {
        sql: "INSERT INTO migrations (version, applied_at, checksum) VALUES (?, ?, ?)",
        args: [version, new Date().toISOString(), checksum(sql)],
      },
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

/** Retries with backoff for as long as it takes; Railway's health check decides when to give up. */
export async function runMigrationsUntilApplied(): Promise<void> {
  let delayMs = RETRY_MIN_MS;
  while (true) {
    try {
      return await runMigrations();
    } catch (err) {
      log.error(
        { err, retryInMs: delayMs },
        "Failed to run migrations, retrying",
      );
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, RETRY_MAX_MS);
    }
  }
}
