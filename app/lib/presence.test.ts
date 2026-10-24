// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import type { Username } from "@/lib/session";
import { batch, query } from "@/lib/turso";
import { failQuery, sqliteBeforeEach } from "@/mocks/sqlite";

import { MIGRATIONS } from "./migrations";
import { joinPresence } from "./presence";

vi.mock(import("@/lib/turso"), async () =>
  (await import("@/mocks/sqlite")).mockTurso(),
);

const alice = "alice" as Username;
const bob = "bob" as Username;

const sqlite = sqliteBeforeEach(query, MIGRATIONS);

// Stands in for a stream on the other replica.
async function seenElsewhere(username: string, at = Date.now()) {
  await sqlite()(
    "INSERT INTO presence (username, seen_at) VALUES (?, ?) ON CONFLICT (username) DO UPDATE SET seen_at = excluded.seen_at",
    [username, at],
  );
}

async function storedUsernames() {
  const { rows } = await sqlite()(
    "SELECT username FROM presence ORDER BY username",
  );
  return rows.map((row) => row["username"]);
}

// Holds the next batch back until the returned function is called.
function holdNextBatch() {
  const { promise, resolve } = Promise.withResolvers<void>();
  const run = vi.mocked(batch).getMockImplementation()!;
  vi.mocked(batch).mockImplementationOnce(async (statements) => {
    await promise;
    return run(statements);
  });
  return resolve;
}

const heartbeat = () => vi.advanceTimersByTimeAsync(15_000);

describe("joinPresence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("tells a new stream who is here at once, then adds the other replica's", async () => {
    await seenElsewhere(bob);
    const listener = vi.fn();

    joinPresence(alice, listener);

    expect(listener).toHaveBeenLastCalledWith(["alice"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenLastCalledWith(["alice", "bob"]);
    expect(await storedUsernames()).toEqual(["alice", "bob"]);
  });

  it("tells every stream when someone joins, and only on a change", async () => {
    const first = vi.fn();
    joinPresence(alice, first);
    await vi.advanceTimersByTimeAsync(0);

    joinPresence(bob, vi.fn());
    joinPresence(undefined, vi.fn());
    await heartbeat();

    expect(first.mock.calls).toEqual([[["alice"]], [["alice", "bob"]]]);
  });

  it("drops a visitor whose heartbeats stopped", async () => {
    await seenElsewhere(bob);
    const listener = vi.fn();
    joinPresence(alice, listener);
    await vi.advanceTimersByTimeAsync(0);

    await heartbeat();
    await heartbeat();
    expect(listener).toHaveBeenLastCalledWith(["alice", "bob"]);
    await heartbeat();

    expect(listener).toHaveBeenLastCalledWith(["alice"]);
    expect(await storedUsernames()).toEqual(["alice"]);
  });

  it("counts a visitor's tabs once and keeps them until the last closes", async () => {
    const listener = vi.fn();
    joinPresence(undefined, listener);
    joinPresence(undefined, vi.fn())();
    const leaveFirst = joinPresence(alice, vi.fn());
    const leaveSecond = joinPresence(alice, vi.fn());

    leaveFirst();
    expect(listener).toHaveBeenLastCalledWith(["alice"]);
    leaveSecond();

    expect(listener).toHaveBeenLastCalledWith([]);
  });

  it("stops heartbeating when the last stream leaves", async () => {
    const leave = joinPresence(alice, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(query).mockClear();

    leave();
    await heartbeat();

    expect(query).not.toHaveBeenCalled();
  });

  it("skips a heartbeat while the last one is still running", async () => {
    await seenElsewhere(bob);
    const resolve = holdNextBatch();
    const listener = vi.fn();
    joinPresence(alice, listener);

    await heartbeat();
    expect(batch).toHaveBeenCalledOnce();
    resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(listener).toHaveBeenLastCalledWith(["alice", "bob"]);
  });

  it("starts afresh when everyone left during a heartbeat", async () => {
    const resolve = holdNextBatch();
    joinPresence(alice, vi.fn())();

    const listener = vi.fn();
    joinPresence(undefined, listener);
    await vi.advanceTimersByTimeAsync(0);
    resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(batch).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledExactlyOnceWith([]);
  });

  it("keeps who it last saw when a heartbeat fails", async () => {
    await seenElsewhere(bob);
    const listener = vi.fn();
    joinPresence(alice, listener);
    await vi.advanceTimersByTimeAsync(0);

    vi.mocked(query).mockImplementation(failQuery(sqlite(), "SELECT"));
    await heartbeat();

    expect(log.warn).toHaveBeenCalledWith(
      { err: new Error("boom") },
      "Presence heartbeat failed",
    );
    expect(listener).toHaveBeenLastCalledWith(["alice", "bob"]);
  });
});
