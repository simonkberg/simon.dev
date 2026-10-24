import "server-only";
import { getGlobal } from "@/lib/global";
import { log } from "@/lib/log";
import { LruMap } from "@/lib/LruMap";
import type { Username } from "@/lib/session";
import { batch, query } from "@/lib/turso";

// The input pings every 2s while its text changes, so a typist outlasts one late ping.
const TYPING_MS = 4_000;
// Turso has no pub/sub, so each replica reads who is typing this often while it has streams.
const POLL_MS = 1_000;
// Twice the input's rate, so only a client that ignores it is turned away.
const PING_MIN_MS = 1_000;

type Listener = (typing: readonly string[]) => void;

type SiteTyping = {
  listeners: Set<Listener>;
  typing: readonly string[];
  pinged: LruMap<string, number>;
  timer?: NodeJS.Timeout;
  reading: boolean;
  again: boolean;
  failing: boolean;
};

const siteTyping = () =>
  getGlobal<SiteTyping>("site-typing", () => ({
    listeners: new Set(),
    typing: [],
    pinged: new LruMap(1000),
    reading: false,
    again: false,
    failing: false,
  }));

async function read(state: SiteTyping): Promise<void> {
  const now = Date.now();
  try {
    const [, { rows }] = await batch([
      { sql: "DELETE FROM typing WHERE until <= ?", args: [now] },
      { sql: "SELECT username FROM typing ORDER BY username" },
    ]);
    state.failing = false;
    const typing = rows.map((row) => String(row["username"]));
    if (typing.join("\n") === state.typing.join("\n")) return;
    state.typing = typing;
    for (const listener of state.listeners) listener(typing);
  } catch (err) {
    // Once per outage, since this runs every second.
    if (!state.failing) log.warn({ err }, "Failed to read who is typing");
    state.failing = true;
  }
}

// A read asked for while one runs follows it, rather than racing it.
async function poll(state: SiteTyping): Promise<void> {
  if (state.reading) {
    state.again = true;
    return;
  }
  state.reading = true;
  do {
    state.again = false;
    await read(state);
  } while (state.again);
  state.reading = false;
}

/** Marks `username` as typing for a few seconds, or as done, and tells this replica's streams at once. */
export async function setTyping(
  username: Username,
  typing: boolean,
): Promise<void> {
  const state = siteTyping();
  const now = Date.now();
  if (typing) {
    if (now - (state.pinged.get(username) ?? 0) < PING_MIN_MS) return;
    state.pinged.set(username, now);
    await query(
      `INSERT INTO typing (username, until) VALUES (?, ?)
       ON CONFLICT (username) DO UPDATE SET until = excluded.until`,
      [username, now + TYPING_MS],
    );
  } else {
    state.pinged.delete(username);
    await query("DELETE FROM typing WHERE username = ?", [username]);
  }
  if (state.listeners.size > 0) await poll(state);
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
