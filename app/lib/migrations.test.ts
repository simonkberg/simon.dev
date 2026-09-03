import type { Redis } from "@upstash/redis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { query } from "@/lib/turso";

import { MIGRATIONS, runMigrations } from "./migrations";

vi.mock(import("server-only"), () => ({}));
vi.mock(import("@/lib/turso"), () => ({ query: vi.fn() }));

const setMock = vi.fn();
const delMock = vi.fn();
vi.mock(import("@/lib/redis"), () => ({
  getRedis: () => ({ set: setMock, del: delMock }) as unknown as Redis,
}));

const emptyResult = { rows: [], rowsAffected: 0, lastInsertRowId: null };

function mockAppliedVersions(versions: number[]) {
  vi.mocked(query).mockImplementation(async (sql) =>
    sql.startsWith("SELECT version")
      ? { ...emptyResult, rows: versions.map((version) => ({ version })) }
      : emptyResult,
  );
}

describe("runMigrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(log, "info").mockImplementation(() => {});
    setMock.mockResolvedValue("OK");
    delMock.mockResolvedValue(1);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should apply every migration on a fresh database", async () => {
    mockAppliedVersions([]);

    await runMigrations();

    const statements = vi.mocked(query).mock.calls.map(([sql]) => sql);
    for (const migration of MIGRATIONS) {
      expect(statements).toContain(migration);
    }
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO migrations"),
      [MIGRATIONS.length, expect.any(String)],
    );
  });

  it("should skip migrations that are already applied", async () => {
    mockAppliedVersions([1]);

    await runMigrations();

    const statements = vi.mocked(query).mock.calls.map(([sql]) => sql);
    expect(statements).not.toContain(MIGRATIONS[0]);
    expect(statements).toContain(MIGRATIONS[1]);
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO migrations"),
      [1, expect.any(String)],
    );
  });

  it("should do nothing when everything is applied", async () => {
    mockAppliedVersions(MIGRATIONS.map((_, index) => index + 1));

    await runMigrations();

    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO migrations"),
      expect.anything(),
    );
    expect(log.info).not.toHaveBeenCalled();
  });

  it("should take the lock before touching the database and release it after", async () => {
    mockAppliedVersions([]);

    await runMigrations();

    expect(setMock).toHaveBeenCalledWith("turso:migrations:lock", "1", {
      nx: true,
      ex: 60,
    });
    expect(setMock.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(query).mock.invocationCallOrder[0] ?? 0,
    );
    expect(delMock).toHaveBeenCalledWith("turso:migrations:lock");
  });

  it("should wait for another instance to release the lock", async () => {
    mockAppliedVersions([]);
    setMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("OK");
    vi.useFakeTimers();

    const running = runMigrations();
    await vi.runAllTimersAsync();
    await running;

    expect(setMock).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenCalled();
  });

  it("should give up when the lock never frees", async () => {
    setMock.mockResolvedValue(null);
    vi.useFakeTimers();

    const expectation = expect(runMigrations()).rejects.toThrow(
      "Timed out waiting for the migrations lock",
    );
    await vi.runAllTimersAsync();
    await expectation;

    expect(setMock).toHaveBeenCalledTimes(60);
    expect(query).not.toHaveBeenCalled();
    expect(delMock).not.toHaveBeenCalled();
  });

  it("should release the lock when a migration fails", async () => {
    vi.mocked(query).mockRejectedValue(new Error("boom"));

    await expect(runMigrations()).rejects.toThrow("boom");
    expect(delMock).toHaveBeenCalledWith("turso:migrations:lock");
  });
});
