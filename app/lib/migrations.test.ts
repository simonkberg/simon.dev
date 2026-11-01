// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { query } from "@/lib/turso";
import { failQuery, sqliteBeforeEach, selectRows } from "@/mocks/sqlite";

import {
  BOOTSTRAP,
  MIGRATIONS,
  runMigrations,
  runMigrationsUntilApplied,
} from "./migrations";

vi.mock(import("@/lib/turso"), async () =>
  (await import("@/mocks/sqlite")).mockTurso(),
);

const sqlite = sqliteBeforeEach(query);

function failNext(prefix: string, { afterRunning = false } = {}) {
  vi.mocked(query).mockImplementation(
    failQuery(
      sqlite(),
      prefix,
      afterRunning ? { afterRunning } : { once: true },
    ),
  );
}

// Not every migration can run twice, so these build their state without one.
async function holdLock(owner: string, expiresAt: number) {
  for (const sql of BOOTSTRAP) await query({ sql });
  await query({
    sql: "INSERT INTO locks VALUES ('migrations', ?, ?)",
    args: [owner, expiresAt],
  });
}

// As made before checksums were recorded, with only the first migration applied.
async function applyFirstOnly() {
  await query({
    sql: "CREATE TABLE migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  });
  await query({ sql: String(MIGRATIONS[0]) });
  await query({
    sql: "INSERT INTO migrations VALUES (1, '2025-01-01T00:00:00.000Z')",
  });
}

async function appliedVersions(): Promise<unknown[]> {
  const rows = await selectRows(query, "SELECT version FROM migrations");
  return rows.map((row) => row["version"]);
}

function lockOwners(): unknown[] {
  return vi
    .mocked(query)
    .mock.calls.filter(([{ sql }]) => sql.startsWith("INSERT INTO locks"))
    .map(([{ args }]) => args?.[1]);
}

describe("runMigrations", () => {
  it("should record a checksum for each applied migration", async () => {
    await runMigrations();

    const rows = await selectRows(
      query,
      "SELECT DISTINCT length(checksum) AS length FROM migrations",
    );
    expect(rows).toEqual([{ length: 64 }]);
  });

  it("should refuse to run when an applied migration was edited", async () => {
    await runMigrations();
    await query({
      sql: "UPDATE migrations SET checksum = 'edited' WHERE version IN (1, 3)",
    });

    await expect(runMigrations()).rejects.toThrow(
      "Applied migrations were edited: 1, 3",
    );
    expect(await selectRows(query, "SELECT * FROM locks")).toEqual([]);
  });

  it("should run on a database migrated by newer code, as after a rollback", async () => {
    await runMigrations();
    await query({
      sql: "INSERT INTO migrations VALUES (?, '2025-01-01T00:00:00.000Z', 'from the future')",
      args: [MIGRATIONS.length + 1],
    });

    await expect(runMigrations()).resolves.toBeUndefined();
  });

  it("should upgrade a migrations table from before checksums", async () => {
    await applyFirstOnly();

    await runMigrations();

    expect(await appliedVersions()).toEqual(MIGRATIONS.map((_, i) => i + 1));
    const rows = await selectRows(
      query,
      "SELECT count(*) AS missing FROM migrations WHERE checksum IS NULL",
    );
    expect(rows).toEqual([{ missing: 0 }]);
    await expect(runMigrations()).resolves.toBeUndefined();
  });

  it("should report the real error when checking for the checksum column fails", async () => {
    await runMigrations();
    failNext("SELECT checksum FROM migrations LIMIT 0");

    await expect(runMigrations()).rejects.toThrow("boom");
  });

  it("should apply only the pending migrations and release the lock", async () => {
    await applyFirstOnly();

    await runMigrations();

    expect(await appliedVersions()).toEqual(MIGRATIONS.map((_, i) => i + 1));
    expect(log.info).toHaveBeenCalledTimes(MIGRATIONS.length - 1);
    expect(log.info).not.toHaveBeenCalledWith(
      { version: 1 },
      "Applied migration",
    );
    expect(await selectRows(query, "SELECT * FROM locks")).toEqual([]);
  });

  it("should use a different owner for each run", async () => {
    await runMigrations();
    await runMigrations();

    const [first, second] = lockOwners();
    expect(first).toEqual(expect.any(String));
    expect(first).not.toBe(second);
  });

  it("should wait for a held lock until its lease expires", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    await holdLock("other", 1_002_000);

    const running = runMigrations();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await appliedVersions()).toEqual([]);

    await vi.advanceTimersByTimeAsync(500);
    await running;
    expect(await appliedVersions()).toHaveLength(MIGRATIONS.length);
  });

  it("should give up when the lock never frees", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    await holdLock("other", Number.MAX_SAFE_INTEGER);

    const expectation = expect(runMigrations()).rejects.toThrow(
      "Timed out waiting for the migrations lock",
    );
    await vi.runAllTimersAsync();
    await expectation;

    expect(await appliedVersions()).toEqual([]);
    expect(await selectRows(query, "SELECT owner FROM locks")).toEqual([
      { owner: "other" },
    ]);
  });

  it("should outwait a lease left behind by a crashed instance", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    await holdLock("crashed", 1_030_000);

    const running = runMigrations();
    await vi.runAllTimersAsync();
    await running;

    expect(await appliedVersions()).toHaveLength(MIGRATIONS.length);
  });

  it("should take the lock when the response to taking it was lost", async () => {
    vi.useFakeTimers();
    failNext("INSERT INTO locks", { afterRunning: true });

    const running = runMigrations();
    await vi.runAllTimersAsync();
    await running;

    expect(await appliedVersions()).toHaveLength(MIGRATIONS.length);
    expect(lockOwners()).toHaveLength(2);
    expect(log.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Failed to take the migrations lock, retrying",
    );
  });

  it("should release the lock when a migration fails", async () => {
    failNext(String(MIGRATIONS[0]));

    await expect(runMigrations()).rejects.toThrow("boom");
    expect(await selectRows(query, "SELECT * FROM locks")).toEqual([]);
  });

  it("should roll back a migration it fails to record", async () => {
    failNext("INSERT INTO migrations");

    await expect(runMigrations()).rejects.toThrow("boom");
    expect(await appliedVersions()).toEqual([]);
    const rows = await selectRows(
      query,
      "SELECT name FROM sqlite_master WHERE name = 'memories'",
    );
    expect(rows).toEqual([]);
  });

  it("should succeed when releasing the lock fails", async () => {
    failNext("DELETE FROM locks");

    await expect(runMigrations()).resolves.toBeUndefined();
    expect(await appliedVersions()).toHaveLength(MIGRATIONS.length);
    expect(log.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Failed to release the migrations lock",
    );
  });
});

describe("runMigrationsUntilApplied", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("should retry with capped backoff until Turso answers", async () => {
    const outage = new Error("The operation was aborted due to timeout");
    const failures = 6;
    for (let i = 0; i < failures; i++) {
      vi.mocked(query).mockRejectedValueOnce(outage);
    }

    const running = runMigrationsUntilApplied();
    await vi.runAllTimersAsync();
    await running;

    expect(await appliedVersions()).toHaveLength(MIGRATIONS.length);
    expect(vi.mocked(log.error).mock.calls.map(([fields]) => fields)).toEqual(
      [1_000, 2_000, 4_000, 8_000, 16_000, 30_000].map((retryInMs) => ({
        err: outage,
        retryInMs,
      })),
    );
  });
});
