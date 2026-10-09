// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetGlobal } from "@/lib/global";
import { log } from "@/lib/log";
import { query } from "@/lib/turso";
import { createSqliteQuery, emptyResult } from "@/mocks/sqlite";

import { MIGRATIONS } from "./migrations";
import { rateLimit } from "./rateLimit";

vi.mock(import("server-only"), () => ({}));
vi.mock(import("@/lib/turso"), () => ({ query: vi.fn() }));

const options = { limit: 3, windowMs: 30_000 };

async function countRows(): Promise<unknown> {
  const { rows } = await query("SELECT count(*) AS n FROM rate_limits");
  return rows[0]?.["n"];
}

describe("rateLimit", () => {
  beforeEach(() => {
    resetGlobal("simon.dev/rate-limit-blocked");
    vi.useFakeTimers({ now: 1_000_000 });
    vi.mocked(query).mockImplementation(createSqliteQuery(MIGRATIONS));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should allow requests up to the limit", async () => {
    for (let i = 0; i < options.limit; i++) {
      expect(await rateLimit("a", options)).toEqual({ success: true });
    }
  });

  it("should reject past the limit until the oldest request leaves the window", async () => {
    await rateLimit("a", options);
    vi.advanceTimersByTime(10_000);
    await rateLimit("a", options);
    await rateLimit("a", options);

    expect(await rateLimit("a", options)).toEqual({
      success: false,
      retryAfterSeconds: 20,
    });

    vi.advanceTimersByTime(19_999);
    expect(await rateLimit("a", options)).toEqual({
      success: false,
      retryAfterSeconds: 1,
    });

    vi.advanceTimersByTime(1);
    expect(await rateLimit("a", options)).toEqual({ success: true });
  });

  it("should admit exactly the limit when requests race", async () => {
    const results = await Promise.all(
      Array.from({ length: options.limit + 3 }, () => rateLimit("a", options)),
    );

    expect(results.filter((result) => result.success)).toHaveLength(
      options.limit,
    );
  });

  it("should reset from the oldest request of this key inside the window", async () => {
    vi.advanceTimersByTime(5_000);
    for (let i = 0; i < options.limit; i++) await rateLimit("a", options);
    await query("INSERT INTO rate_limits (key, at) VALUES ('a', ?)", [
      1_005_000 - options.windowMs,
    ]);
    await query("INSERT INTO rate_limits (key, at) VALUES ('b', 1000001)");

    expect(await rateLimit("a", options)).toEqual({
      success: false,
      retryAfterSeconds: 30,
    });
  });

  it("should ask for a retry soon when the oldest request left the window meanwhile", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce({ ...emptyResult, rows: [{ oldest: null }] });

    expect(await rateLimit("a", options)).toEqual({
      success: false,
      retryAfterSeconds: 1,
    });
  });

  it("should fail open when the database fails", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const err = new Error("boom");
    vi.mocked(query).mockRejectedValueOnce(err);

    expect(await rateLimit("a", options)).toEqual({ success: true });
    expect(warn).toHaveBeenCalledWith({ err, key: "a" }, "Rate limiter failed");
  });

  it("should not record rejected requests", async () => {
    for (let i = 0; i < options.limit + 2; i++) await rateLimit("a", options);

    expect(await countRows()).toBe(options.limit);
  });

  it("should turn a blocked key away without asking the database", async () => {
    for (let i = 0; i <= options.limit; i++) await rateLimit("a", options);
    vi.mocked(query).mockClear();
    vi.advanceTimersByTime(10_000);

    expect(await rateLimit("a", options)).toEqual({
      success: false,
      retryAfterSeconds: 20,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("should count each key separately", async () => {
    for (let i = 0; i < options.limit; i++) await rateLimit("a", options);

    expect(await rateLimit("b", options)).toEqual({ success: true });
    expect((await rateLimit("a", options)).success).toBe(false);
  });

  it("should prune requests outside the window when it records one", async () => {
    await rateLimit("a", options);
    vi.advanceTimersByTime(20_000);
    await rateLimit("b", options);
    vi.advanceTimersByTime(10_000);

    await rateLimit("c", options);

    expect(await countRows()).toBe(2);
  });

  it("should log rather than throw when pruning fails", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const sqlite = createSqliteQuery(MIGRATIONS);
    vi.mocked(query).mockImplementation(async (sql, args) =>
      sql.startsWith("DELETE")
        ? Promise.reject(new Error("boom"))
        : sqlite(sql, args),
    );

    expect(await rateLimit("a", options)).toEqual({ success: true });
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        "Failed to prune rate limits",
      ),
    );
  });
});
