// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { query } from "@/lib/turso";
import { createSqliteQuery } from "@/mocks/sqlite";

import { MIGRATIONS, runMigrations } from "./migrations";

vi.mock(import("server-only"), () => ({}));
vi.mock(import("@/lib/turso"), () => ({ query: vi.fn() }));

let sqlite: typeof query;

function failNext(prefix: string, { afterRunning = false } = {}) {
  let failed = false;
  vi.mocked(query).mockImplementation(async (sql, args) => {
    if (failed || !sql.startsWith(prefix)) return sqlite(sql, args);
    failed = true;
    if (afterRunning) await sqlite(sql, args);
    throw new Error("boom");
  });
}

async function holdLock(owner: string, expiresAt: number) {
  await runMigrations();
  await query("DELETE FROM migrations");
  await query("INSERT INTO locks VALUES ('migrations', ?, ?)", [
    owner,
    expiresAt,
  ]);
}

async function appliedVersions(): Promise<unknown[]> {
  const { rows } = await query("SELECT version FROM migrations");
  return rows.map((row) => row["version"]);
}

function lockOwners(): unknown[] {
  return vi
    .mocked(query)
    .mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO locks"))
    .map(([, args]) => args?.[1]);
}

describe("runMigrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(log, "info").mockImplementation(() => {});
    vi.spyOn(log, "warn").mockImplementation(() => {});
    sqlite = createSqliteQuery();
    vi.mocked(query).mockImplementation(sqlite);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should record a checksum for each applied migration", async () => {
    await runMigrations();

    const { rows } = await query(
      "SELECT DISTINCT length(checksum) AS length FROM migrations",
    );
    expect(rows).toEqual([{ length: 64 }]);
  });

  it("should refuse to run when an applied migration was edited", async () => {
    await runMigrations();
    await query(
      "UPDATE migrations SET checksum = 'edited' WHERE version IN (1, 3)",
    );

    await expect(runMigrations()).rejects.toThrow(
      "Applied migrations were edited: 1, 3",
    );
    expect((await query("SELECT * FROM locks")).rows).toEqual([]);
  });

  it("should upgrade a migrations table from before checksums", async () => {
    await query(
      "CREATE TABLE migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    await query(String(MIGRATIONS[0]));
    await query(
      "INSERT INTO migrations VALUES (1, '2025-01-01T00:00:00.000Z')",
    );

    await runMigrations();

    expect(await appliedVersions()).toEqual(MIGRATIONS.map((_, i) => i + 1));
    const { rows } = await query(
      "SELECT count(*) AS missing FROM migrations WHERE checksum IS NULL",
    );
    expect(rows).toEqual([{ missing: 0 }]);
    await expect(runMigrations()).resolves.toBeUndefined();
  });

  it("should apply only the pending migrations and release the lock", async () => {
    await runMigrations();
    await query("DELETE FROM migrations WHERE version > 1");
    vi.mocked(log.info).mockClear();

    await runMigrations();

    expect(await appliedVersions()).toEqual(MIGRATIONS.map((_, i) => i + 1));
    expect(log.info).toHaveBeenCalledTimes(MIGRATIONS.length - 1);
    expect(log.info).not.toHaveBeenCalledWith(
      { version: 1 },
      "Applied migration",
    );
    expect((await query("SELECT * FROM locks")).rows).toEqual([]);
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
    expect((await query("SELECT owner FROM locks")).rows).toEqual([
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
    expect((await query("SELECT * FROM locks")).rows).toEqual([]);
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
