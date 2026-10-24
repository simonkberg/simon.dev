import "server-only";
import { getGlobal } from "@/lib/global";
import { log } from "@/lib/log";
import type { Username } from "@/lib/session";
import { batch, query } from "@/lib/turso";

const HEARTBEAT_MS = 15_000;
// Three heartbeats, so one slow request doesn't drop anyone.
const EXPIRY_MS = 45_000;
// Past this, another replica may have expired this one's rows.
const LATE_MS = 2 * HEARTBEAT_MS;

type Listener = (here: readonly string[]) => void;

type Presence = {
  // Stream id to username, for the streams this replica holds.
  streams: Map<string, string>;
  // Writes the next heartbeat makes, kept until one succeeds.
  joined: Map<string, string>;
  left: Set<string>;
  listeners: Set<Listener>;
  here: readonly string[];
  timer?: NodeJS.Timeout;
  written: number;
  beating: boolean;
  again: boolean;
};

// One row per stream, so a visitor's tabs and reloads come and go on their own.
// Each replica sees only its own streams, so Turso holds everyone's.
const presence = () =>
  getGlobal<Presence>("presence", () => ({
    streams: new Map(),
    joined: new Map(),
    left: new Set(),
    listeners: new Set(),
    here: [],
    written: 0,
    beating: false,
    again: false,
  }));

function publish(state: Presence, here: readonly string[]): void {
  if (here.join("\n") === state.here.join("\n")) return;
  state.here = here;
  for (const listener of state.listeners) listener(here);
}

// Writes this replica's streams in one batch, so each one's insert, refreshes and delete land in order.
async function heartbeat(state: Presence): Promise<void> {
  // A heartbeat asked for while one runs follows it, rather than racing it.
  if (state.beating) {
    state.again = true;
    return;
  }
  state.beating = true;
  state.again = false;
  const now = Date.now();
  // Not every stream once late, since that would bring back one a beacon took out.
  const joined = new Map(
    now - state.written > LATE_MS ? state.streams : state.joined,
  );
  const left = new Set(state.left);
  try {
    const [, , , , { rows }] = await batch([
      {
        sql: "INSERT OR IGNORE INTO presence (stream, username, seen_at) SELECT key, value, ? FROM json_each(?)",
        args: [now, JSON.stringify(Object.fromEntries(joined))],
      },
      {
        sql: "DELETE FROM presence WHERE stream IN (SELECT value FROM json_each(?))",
        args: [JSON.stringify([...left])],
      },
      {
        sql: "UPDATE presence SET seen_at = ? WHERE stream IN (SELECT value FROM json_each(?))",
        args: [now, JSON.stringify([...state.streams.keys()])],
      },
      {
        sql: "DELETE FROM presence WHERE seen_at <= ?",
        args: [now - EXPIRY_MS],
      },
      { sql: "SELECT DISTINCT username FROM presence ORDER BY username" },
    ]);
    state.written = now;
    for (const stream of joined.keys()) state.joined.delete(stream);
    for (const stream of left) state.left.delete(stream);
    if (state.listeners.size > 0) {
      publish(
        state,
        rows.map((row) => String(row["username"])),
      );
    } else if (state.left.size === 0) {
      clearInterval(state.timer);
      state.timer = undefined;
      state.here = [];
    }
  } catch (err) {
    log.warn({ err }, "Presence heartbeat failed");
  } finally {
    state.beating = false;
  }
  if (state.again) await heartbeat(state);
}

/** Counts `username` as here until the stream leaves, and tells `listener` who is here now and on every change. */
export function joinPresence(
  stream: string,
  username: Username | undefined,
  listener: Listener,
): () => void {
  const state = presence();
  state.listeners.add(listener);
  listener(state.here);
  state.timer ??= setInterval(
    () => void heartbeat(state),
    HEARTBEAT_MS,
  ).unref();
  if (username) {
    state.streams.set(stream, username);
    state.joined.set(stream, username);
  }
  void heartbeat(state);

  return () => {
    state.listeners.delete(listener);
    if (state.streams.delete(stream)) {
      state.joined.delete(stream);
      state.left.add(stream);
    }
    void heartbeat(state);
  };
}

/** Takes a stream out at once, for a page that says it is closing before the server notices. */
export async function leavePresence(
  stream: string,
  username: Username,
): Promise<void> {
  try {
    await query("DELETE FROM presence WHERE stream = ? AND username = ?", [
      stream,
      username,
    ]);
  } catch (err) {
    log.warn({ err }, "Failed to take a stream out of presence");
    return;
  }
  const state = presence();
  if (state.timer) await heartbeat(state);
}
