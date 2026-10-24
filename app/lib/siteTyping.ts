import "server-only";
import { getGlobal } from "@/lib/global";
import { log } from "@/lib/log";
import { LruMap } from "@/lib/LruMap";
import type { Username } from "@/lib/session";
import { batch, type Statement } from "@/lib/turso";

// The input pings every 2s while its text changes, so a typist outlasts one late ping.
const TYPING_MS = 4_000;
// Turso has no pub/sub, so each replica reads who is typing this often while it has streams.
const POLL_MS = 1_000;
// Kept in memory rather than with rateLimit, which would cost a write per ping.
const PING_MIN_MS = 1_000;

type Listener = (typing: readonly string[]) => void;

type SiteTyping = {
  listeners: Set<Listener>;
  typing: readonly string[];
  pinged: LruMap<string, number>;
  timer?: NodeJS.Timeout;
  reading: boolean;
  failing: boolean;
};

const siteTyping = () =>
  getGlobal<SiteTyping>("site-typing", () => ({
    listeners: new Set(),
    typing: [],
    pinged: new LruMap(1000),
    reading: false,
    failing: false,
  }));

// Runs the writes, if any, and reads who is typing after them in the same request.
async function read(
  state: SiteTyping,
  writes: Statement[] = [],
): Promise<void> {
  const results = await batch([
    ...writes,
    {
      sql: "SELECT username FROM typing WHERE until > ? ORDER BY username",
      args: [Date.now()],
    },
  ]);
  const typing = results.at(-1)!.rows.map((row) => String(row["username"]));
  if (state.listeners.size === 0) return;
  if (typing.join("\n") === state.typing.join("\n")) return;
  state.typing = typing;
  for (const listener of state.listeners) listener(typing);
}

// A poll still out when the next is due is let finish rather than raced.
async function poll(state: SiteTyping): Promise<void> {
  if (state.reading) return;
  state.reading = true;
  try {
    await read(state);
    state.failing = false;
  } catch (err) {
    // Once per outage, since this runs every second.
    if (!state.failing) log.warn({ err }, "Failed to read who is typing");
    state.failing = true;
  } finally {
    state.reading = false;
  }
}

/** Marks `username` as typing for a few seconds, and tells this replica's streams at once. */
export async function setTyping(username: Username): Promise<void> {
  const state = siteTyping();
  const now = Date.now();
  if (now - (state.pinged.get(username) ?? 0) < PING_MIN_MS) return;
  state.pinged.set(username, now);
  await read(state, [
    // Pruned here rather than by the polls, so those stay reads.
    { sql: "DELETE FROM typing WHERE until <= ?", args: [now] },
    {
      sql: `INSERT INTO typing (username, until) VALUES (?, ?)
            ON CONFLICT (username) DO UPDATE SET until = excluded.until`,
      args: [username, now + TYPING_MS],
    },
  ]);
}

/** Ends `username`'s typing, as their post lands. Never throws, since the post matters more. */
export async function stopTyping(username: Username): Promise<void> {
  const state = siteTyping();
  state.pinged.delete(username);
  try {
    await read(state, [
      { sql: "DELETE FROM typing WHERE username = ?", args: [username] },
    ]);
  } catch (err) {
    log.warn({ err }, "Failed to stop typing");
  }
}

/** Tells `listener` which site visitors are typing now and on every change. */
export function subscribeToSiteTyping(listener: Listener): () => void {
  const state = siteTyping();
  state.listeners.add(listener);
  listener(state.typing);
  if (!state.timer) {
    void poll(state);
    state.timer = setInterval(() => void poll(state), POLL_MS).unref();
  }
  return () => {
    state.listeners.delete(listener);
    if (state.listeners.size > 0) return;
    clearInterval(state.timer);
    state.timer = undefined;
    state.typing = [];
  };
}
