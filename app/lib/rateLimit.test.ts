// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { query } from "@/lib/turso";
import {
  emptyResult,
  failQuery,
  sqliteBeforeEach,
  selectRows,
} from "@/mocks/sqlite";

import { MIGRATIONS } from "./migrations";
import { rateLimit } from "./rateLimit";

vi.mock(import("@/lib/turso"), async () =>
  (await import("@/mocks/sqlite")).mockTurso(),
);

const options = { limit: 3, windowMs: 30_000 };

async function countRows(): Promise<unknown> {
  const rows = await selectRows(query, "SELECT count(*) AS n FROM rate_limits");
  return rows[0]?.["n"];
}

const sqlite = sqliteBeforeEach(query, MIGRATIONS);

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
  });

  it("should reject past the limit until the oldest request leaves the window", async () => {
    expect(await rateLimit("a", options)).toEqual({ success: true });
    vi.advanceTimersByTime(10_000);
    expect(await rateLimit("a", options)).toEqual({ success: true });
    expect(await rateLimit("a", options)).toEqual({ success: true });

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
    await query({
      sql: "INSERT INTO rate_limits (key, expires_at) VALUES ('a', 1005000), ('b', 1006000)",
    });

    expect(await rateLimit("a", options)).toEqual({
      success: false,
      retryAfterSeconds: 30,
    });
  });

  it("should ask for a retry soon when the oldest request left the window meanwhile", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce({ ...emptyResult, rows: [{ reset: null }] });

    expect(await rateLimit("a", options)).toEqual({
      success: false,
      retryAfterSeconds: 1,
    });
  });

  it("should fail open when the database fails", async () => {
    const err = new Error("boom");
    vi.mocked(query).mockRejectedValueOnce(err);

    expect(await rateLimit("a", options)).toEqual({ success: true });
    expect(log.warn).toHaveBeenCalledWith(
      { err, key: "a" },
      "Rate limiter failed",
    );
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

  it("should prune each row by its own window", async () => {
    await rateLimit("long", { limit: 3, windowMs: 60_000 });
    await rateLimit("short", options);
    vi.advanceTimersByTime(options.windowMs);

    await rateLimit("c", options);

    const rows = await selectRows(
      query,
      "SELECT key FROM rate_limits ORDER BY key",
    );
    expect(rows).toEqual([{ key: "c" }, { key: "long" }]);
  });

  it("should log rather than throw when pruning fails", async () => {
    vi.mocked(query).mockImplementation(failQuery(sqlite(), "DELETE"));

    expect(await rateLimit("a", options)).toEqual({ success: true });
    await vi.waitFor(() =>
      expect(log.warn).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        "Failed to prune rate limits",
      ),
    );
  });
});
