// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import type { Username } from "@/lib/session";
import { batch, query } from "@/lib/turso";
import { failQuery, sqliteBeforeEach } from "@/mocks/sqlite";

import { MIGRATIONS } from "./migrations";
import { setTyping, subscribeToSiteTyping } from "./siteTyping";

vi.mock(import("@/lib/turso"), async () =>
  (await import("@/mocks/sqlite")).mockTurso(),
);

const alice = "alice" as Username;

const sqlite = sqliteBeforeEach(query, MIGRATIONS);

// Stands in for a ping that reached the other replica.
async function typingElsewhere(username: string, until = Date.now() + 4_000) {
  await sqlite()("INSERT INTO typing (username, until) VALUES (?, ?)", [
    username,
    until,
  ]);
}

async function storedUntil() {
  const { rows } = await sqlite()("SELECT until FROM typing");
  return rows.map((row) => row["until"]);
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

    await setTyping(alice, true);

    expect(listener).toHaveBeenLastCalledWith(["alice", "bob"]);
  });

  it("keeps a typist 4s after their last ping, and only takes one ping a second", async () => {
    const listener = vi.fn();
    subscribeToSiteTyping(listener);
    await setTyping(alice, true);
    await vi.advanceTimersByTimeAsync(500);

    await setTyping(alice, true);
    expect(await storedUntil()).toEqual([1_004_000]);

    await vi.advanceTimersByTimeAsync(3_500);
    expect(listener).toHaveBeenLastCalledWith([]);
  });

  it("drops a typist who stopped, and takes their next ping at once", async () => {
    const listener = vi.fn();
    subscribeToSiteTyping(listener);
    await setTyping(alice, true);

    await setTyping(alice, false);
    expect(listener).toHaveBeenLastCalledWith([]);
    await setTyping(alice, true);

    expect(listener).toHaveBeenLastCalledWith(["alice"]);
  });

  it("logs a failed read once per outage", async () => {
    vi.mocked(query).mockImplementation(failQuery(sqlite(), "SELECT"));
    const listener = vi.fn();
    subscribeToSiteTyping(listener);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(
      { err: new Error("boom") },
      "Failed to read who is typing",
    );
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
    await setTyping(alice, true);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(batch).toHaveBeenCalledOnce();
    expect(await storedUntil()).toEqual([1_001_000 + 4_000]);
  });
});
