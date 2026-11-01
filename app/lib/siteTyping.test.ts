// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import type { Username } from "@/lib/session";
import { batch, query } from "@/lib/turso";
import { failQuery, sqliteBeforeEach, selectRows } from "@/mocks/sqlite";

import { MIGRATIONS } from "./migrations";
import { setTyping, stopTyping, subscribeToSiteTyping } from "./siteTyping";

vi.mock(import("@/lib/turso"), async () =>
  (await import("@/mocks/sqlite")).mockTurso(),
);

const alice = "alice" as Username;

const sqlite = sqliteBeforeEach(query, MIGRATIONS);

// Stands in for a ping that reached the other replica.
async function typingElsewhere(username: string) {
  await sqlite()({
    sql: "INSERT INTO typing (username, until) VALUES (?, ?)",
    args: [username, Date.now() + 4_000],
  });
}

async function stored() {
  const rows = await selectRows(sqlite(), "SELECT username, until FROM typing");
  return rows;
}

const settle = () => vi.advanceTimersByTimeAsync(0);

describe("siteTyping", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
  });

  it("tells a listener who types on either replica, at once on its own", async () => {
    await typingElsewhere("bob");
    const listener = vi.fn();
    subscribeToSiteTyping(listener);
    await settle();
    expect(listener).toHaveBeenLastCalledWith(["bob"]);

    await setTyping(alice);

    expect(listener).toHaveBeenLastCalledWith(["alice", "bob"]);
  });

  it("keeps a typist 4s after their last ping, and only takes one ping a second", async () => {
    const listener = vi.fn();
    subscribeToSiteTyping(listener);
    await setTyping(alice);
    await vi.advanceTimersByTimeAsync(500);

    await setTyping(alice);
    expect(await stored()).toEqual([{ username: "alice", until: 1_004_000 }]);

    await vi.advanceTimersByTimeAsync(3_500);
    expect(listener).toHaveBeenLastCalledWith([]);
  });

  it("clears out expired typists as it stores a ping", async () => {
    await typingElsewhere("bob");
    await vi.advanceTimersByTimeAsync(4_000);

    await setTyping(alice);

    expect(await stored()).toEqual([{ username: "alice", until: 1_008_000 }]);
  });

  it("drops a typist whose post landed, and takes their next ping at once", async () => {
    const listener = vi.fn();
    subscribeToSiteTyping(listener);
    await setTyping(alice);

    await stopTyping(alice);
    expect(listener).toHaveBeenLastCalledWith([]);
    await setTyping(alice);

    expect(listener).toHaveBeenLastCalledWith(["alice"]);
  });

  it("takes the next ping at once after one fails to store", async () => {
    const run = vi.mocked(query).getMockImplementation()!;
    vi.mocked(query).mockImplementation(failQuery(sqlite(), "INSERT"));
    await expect(setTyping(alice)).rejects.toThrow("boom");
    vi.mocked(query).mockImplementation(run);

    await setTyping(alice);

    expect(await stored()).toEqual([{ username: "alice", until: 1_004_000 }]);
  });

  it("doesn't let an older read undo a newer one", async () => {
    await typingElsewhere("alice");
    const { promise, resolve } = Promise.withResolvers<void>();
    const run = vi.mocked(batch).getMockImplementation()!;
    vi.mocked(batch).mockImplementationOnce(async (statements) => {
      const results = await run(statements);
      await promise;
      return results;
    });
    const listener = vi.fn();
    subscribeToSiteTyping(listener);
    await settle();

    await stopTyping(alice);
    resolve();
    await settle();

    expect(listener).toHaveBeenLastCalledWith([]);
  });

  it("logs a failed stop rather than throw", async () => {
    vi.mocked(query).mockImplementation(failQuery(sqlite(), "DELETE"));

    await stopTyping(alice);

    expect(log.warn).toHaveBeenCalledWith(
      { err: new Error("boom") },
      "Failed to stop typing",
    );
  });

  it("logs a failed read once per outage", async () => {
    vi.mocked(query).mockImplementation(failQuery(sqlite(), "SELECT"));
    subscribeToSiteTyping(vi.fn());
    await vi.advanceTimersByTimeAsync(2_000);

    expect(log.warn).toHaveBeenCalledExactlyOnceWith(
      { err: new Error("boom") },
      "Failed to read who is typing",
    );
  });

  it("lets a slow read finish rather than start another", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const run = vi.mocked(batch).getMockImplementation()!;
    vi.mocked(batch).mockImplementationOnce(async (statements) => {
      await promise;
      return run(statements);
    });
    subscribeToSiteTyping(vi.fn());

    await vi.advanceTimersByTimeAsync(2_000);
    expect(batch).toHaveBeenCalledOnce();
    resolve();
  });

  it("reads once for every listener, and stops once the last leaves", async () => {
    const first = subscribeToSiteTyping(vi.fn());
    const second = subscribeToSiteTyping(vi.fn());
    await settle();
    first();
    vi.mocked(batch).mockClear();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(batch).toHaveBeenCalledOnce();

    second();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(batch).toHaveBeenCalledOnce();
  });
});
