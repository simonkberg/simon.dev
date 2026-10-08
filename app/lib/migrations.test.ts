// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { query } from "@/lib/turso";
import { createSqliteQuery } from "@/mocks/sqlite";

import { MIGRATIONS, runMigrations } from "./migrations";

vi.mock(import("server-only"), () => ({}));
vi.mock(import("@/lib/turso"), () => ({ query: vi.fn() }));

const emptyResult = { rows: [], rowsAffected: 0, lastInsertRowId: null };

function mockDatabase({
  applied = [],
  lockResults = [1],
}: { applied?: number[]; lockResults?: number[] } = {}) {
  const locks = [...lockResults];
  vi.mocked(query).mockImplementation(async (sql) => {
    if (sql.startsWith("SELECT version")) {
      return { ...emptyResult, rows: applied.map((version) => ({ version })) };
    }
    if (sql.startsWith("INSERT INTO locks")) {
      return { ...emptyResult, rowsAffected: locks.shift() ?? 0 };
    }
    return emptyResult;
  });
}

function statements(): string[] {
  return vi.mocked(query).mock.calls.map(([sql]) => sql);
}

describe("runMigrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(log, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should apply every migration on a fresh database", async () => {
    mockDatabase();

    await runMigrations();

    for (const migration of MIGRATIONS) {
      expect(statements()).toContain(migration);
    }
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO migrations"),
      [MIGRATIONS.length, expect.any(String)],
    );
  });

  it("should skip migrations that are already applied", async () => {
    mockDatabase({ applied: [1] });

    await runMigrations();

    expect(statements()).not.toContain(MIGRATIONS[0]);
    expect(statements()).toContain(MIGRATIONS[1]);
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO migrations"),
      [1, expect.any(String)],
    );
  });

  it("should do nothing when everything is applied", async () => {
    mockDatabase({ applied: MIGRATIONS.map((_, index) => index + 1) });

    await runMigrations();

    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO migrations"),
      expect.anything(),
    );
    expect(log.info).not.toHaveBeenCalled();
  });

  it("should take the lock before touching migrations and release it after", async () => {
    mockDatabase();

    await runMigrations();

    const sql = statements();
    const lockIndex = sql.findIndex((s) => s.startsWith("INSERT INTO locks"));
    const migrationsIndex = sql.findIndex((s) =>
      s.includes("CREATE TABLE IF NOT EXISTS migrations"),
    );
    expect(sql[0]).toContain("CREATE TABLE IF NOT EXISTS locks");
    expect(lockIndex).toBeGreaterThan(0);
    expect(lockIndex).toBeLessThan(migrationsIndex);

    const lockArgs = vi.mocked(query).mock.calls[lockIndex]?.[1];
    expect(lockArgs).toEqual([
      "migrations",
      expect.any(String),
      expect.any(Number),
      expect.any(Number),
    ]);
    expect(query).toHaveBeenLastCalledWith(
      "DELETE FROM locks WHERE name = ? AND owner = ?",
      ["migrations", lockArgs?.[1]],
    );
  });

  it("should lease the lock for 60 seconds", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    mockDatabase();

    const running = runMigrations();
    await vi.runAllTimersAsync();
    await running;

    const lockArgs = vi
      .mocked(query)
      .mock.calls.find(([sql]) => sql.startsWith("INSERT INTO locks"))?.[1];
    expect(lockArgs?.[2]).toBe(1_060_000);
    expect(lockArgs?.[3]).toBe(1_000_000);
  });

  it("should wait for another instance to release the lock", async () => {
    mockDatabase({ lockResults: [0, 0, 1] });
    vi.useFakeTimers();

    const running = runMigrations();
    await vi.runAllTimersAsync();
    await running;

    expect(
      statements().filter((sql) => sql.startsWith("INSERT INTO locks")),
    ).toHaveLength(3);
    expect(statements()).toContain(MIGRATIONS[0]);
  });

  it("should give up when the lock never frees", async () => {
    mockDatabase({ lockResults: [] });
    vi.useFakeTimers();

    const expectation = expect(runMigrations()).rejects.toThrow(
      "Timed out waiting for the migrations lock",
    );
    await vi.runAllTimersAsync();
    await expectation;

    expect(
      statements().filter((sql) => sql.startsWith("INSERT INTO locks")),
    ).toHaveLength(60);
    expect(statements()).not.toContain(MIGRATIONS[0]);
    expect(
      statements().some((sql) => sql.startsWith("DELETE FROM locks")),
    ).toBe(false);
  });

  it("should release the lock when a migration fails", async () => {
    mockDatabase();
    const actual = vi.mocked(query).getMockImplementation();
    vi.mocked(query).mockImplementation(async (sql, args) =>
      sql === MIGRATIONS[0]
        ? Promise.reject(new Error("boom"))
        : (actual?.(sql, args) ?? emptyResult),
    );

    await expect(runMigrations()).rejects.toThrow("boom");
    expect(query).toHaveBeenLastCalledWith(
      "DELETE FROM locks WHERE name = ? AND owner = ?",
      ["migrations", expect.any(String)],
    );
  });
});

describe("runMigrations against SQLite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(log, "info").mockImplementation(() => {});
    vi.mocked(query).mockImplementation(createSqliteQuery());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should apply every migration once across runs and release the lock", async () => {
    await runMigrations();
    await runMigrations();

    const { rows } = await query("SELECT version FROM migrations");
    expect(rows).toHaveLength(MIGRATIONS.length);
    expect((await query("SELECT * FROM locks")).rows).toEqual([]);
  });

  it("should wait for a held lock and take it over once it expires", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    await query(
      "CREATE TABLE locks (name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL)",
    );
    await query(
      "INSERT INTO locks VALUES ('migrations', 'other', ?)",
      [1_002_000],
    );

    const running = runMigrations();
    await vi.advanceTimersByTimeAsync(1_000);
    const { rows: tables } = await query(
      "SELECT name FROM sqlite_master WHERE name = 'migrations'",
    );
    expect(tables).toEqual([]);

    await vi.runAllTimersAsync();
    await running;

    const { rows } = await query("SELECT version FROM migrations");
    expect(rows).toHaveLength(MIGRATIONS.length);
  });
});
