// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import type { Username } from "@/lib/session";
import { batch, query } from "@/lib/turso";
import { failQuery, sqliteBeforeEach } from "@/mocks/sqlite";

import { MIGRATIONS } from "./migrations";
import { joinPresence, leavePresence } from "./presence";

vi.mock(import("@/lib/turso"), async () =>
  (await import("@/mocks/sqlite")).mockTurso(),
);

const alice = "alice" as Username;
const bob = "bob" as Username;

const sqlite = sqliteBeforeEach(query, MIGRATIONS);

// Stands in for a stream on the other replica.
async function seenElsewhere(username: string, at = Date.now()) {
  await sqlite()(
    "INSERT INTO presence (stream, username, seen_at) VALUES (?, ?, ?)",
    [`elsewhere-${username}`, username, at],
  );
}

async function storedStreams() {
  const { rows } = await sqlite()(
    "SELECT stream FROM presence ORDER BY stream",
  );
  return rows.map((row) => row["stream"]);
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

const settle = () => vi.advanceTimersByTimeAsync(0);
const heartbeat = () => vi.advanceTimersByTimeAsync(15_000);

describe("joinPresence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("stores the stream and tells it who is here, the other replica's included", async () => {
    await seenElsewhere(bob);
    const listener = vi.fn();

    joinPresence("a1", alice, listener);
    expect(listener).toHaveBeenLastCalledWith([]);
    await settle();

    expect(listener).toHaveBeenLastCalledWith(["alice", "bob"]);
    expect(await storedStreams()).toEqual(["a1", "elsewhere-bob"]);
  });

  it("tells every stream when someone joins, and only on a change", async () => {
    const first = vi.fn();
    joinPresence("a1", alice, first);
    await settle();

    joinPresence("b1", bob, vi.fn());
    joinPresence("anon", undefined, vi.fn());
    await settle();
    await heartbeat();

    expect(first.mock.calls).toEqual([[[]], [["alice"]], [["alice", "bob"]]]);
  });

  it("keeps its own streams and drops one whose heartbeats stopped", async () => {
    await seenElsewhere(bob);
    const listener = vi.fn();
    joinPresence("a1", alice, listener);
    await settle();

    await heartbeat();
    await heartbeat();
    expect(listener).toHaveBeenLastCalledWith(["alice", "bob"]);
    await heartbeat();

    expect(listener).toHaveBeenLastCalledWith(["alice"]);
    expect(await storedStreams()).toEqual(["a1"]);
  });

  it("keeps a visitor while any of their tabs is open", async () => {
    const listener = vi.fn();
    joinPresence("anon", undefined, listener);
    const leaveFirst = joinPresence("a1", alice, vi.fn());
    const leaveSecond = joinPresence("a2", alice, vi.fn());
    await settle();

    leaveFirst();
    await heartbeat();
    expect(listener).toHaveBeenLastCalledWith(["alice"]);
    leaveSecond();
    await heartbeat();

    expect(listener).toHaveBeenLastCalledWith([]);
    expect(await storedStreams()).toEqual([]);
  });

  it("stops heartbeating when the last stream leaves", async () => {
    joinPresence("a1", alice, vi.fn())();
    joinPresence("anon", undefined, vi.fn())();
    await heartbeat();

    expect(batch).not.toHaveBeenCalled();
    expect(await storedStreams()).toEqual([]);
  });

  it("runs a heartbeat asked for during one right after it", async () => {
    const resolve = holdNextBatch();
    const listener = vi.fn();
    joinPresence("a1", alice, listener);
    await settle();

    joinPresence("b1", bob, vi.fn());
    await settle();
    resolve();
    await settle();

    expect(batch).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(["alice", "bob"]);
  });

  it("starts afresh when everyone left during a heartbeat", async () => {
    await seenElsewhere(bob);
    const resolve = holdNextBatch();
    const leave = joinPresence("a1", alice, vi.fn());
    await settle();
    leave();

    const listener = vi.fn();
    joinPresence("anon", undefined, listener);
    await settle();
    resolve();
    await settle();

    expect(batch).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls).toEqual([[[]], [["bob"]]]);
  });

  it("keeps who it last saw when a heartbeat fails", async () => {
    await seenElsewhere(bob);
    const listener = vi.fn();
    joinPresence("a1", alice, listener);
    await settle();

    vi.mocked(query).mockImplementation(failQuery(sqlite(), "SELECT"));
    await heartbeat();

    expect(log.warn).toHaveBeenCalledWith(
      { err: new Error("boom") },
      "Presence heartbeat failed",
    );
    expect(listener).toHaveBeenLastCalledWith(["alice", "bob"]);
  });

  it("logs a stream it couldn't store", async () => {
    vi.mocked(query).mockImplementation(failQuery(sqlite(), "INSERT"));

    joinPresence("a1", alice, vi.fn());
    await settle();

    expect(log.warn).toHaveBeenCalledWith(
      { err: new Error("boom") },
      "Presence write failed",
    );
  });
});

describe("leavePresence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("takes the visitor's stream out and tells everyone at once", async () => {
    await seenElsewhere(alice);
    const listener = vi.fn();
    joinPresence("b1", bob, listener);
    await settle();

    await leavePresence("elsewhere-alice", alice);

    expect(listener).toHaveBeenLastCalledWith(["bob"]);
    expect(await storedStreams()).toEqual(["b1"]);
  });

  it("leaves another visitor's stream alone", async () => {
    await seenElsewhere(alice);

    await leavePresence("elsewhere-alice", bob);

    expect(await storedStreams()).toEqual(["elsewhere-alice"]);
  });
});
