import "server-only";
import { log } from "@/lib/log";
import { getRedis } from "@/lib/redis";
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
];

const LOCK_KEY = "turso:migrations:lock";
const LOCK_TTL = 60;
const LOCK_RETRY_MS = 500;
const LOCK_ATTEMPTS = 60;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function acquireLock(): Promise<void> {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    const result = await getRedis().set(LOCK_KEY, "1", {
      nx: true,
      ex: LOCK_TTL,
    });
    if (result === "OK") return;
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
  await acquireLock();
  try {
    await applyPending();
  } finally {
    await getRedis().del(LOCK_KEY);
  }
}
