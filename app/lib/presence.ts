import "server-only";
import { getGlobal } from "@/lib/global";
import { log } from "@/lib/log";
import type { Username } from "@/lib/session";
import { batch } from "@/lib/turso";

const HEARTBEAT_MS = 15_000;
// Three heartbeats, so one slow request doesn't drop anyone.
const EXPIRY_MS = 45_000;

type Listener = (here: readonly string[]) => void;

type Presence = {
  // Stream id to username, for the streams this replica holds.
  streams: Map<string, string>;
  // Streams that closed, kept until a heartbeat takes their rows out.
  left: Set<string>;
  listeners: Set<Listener>;
  here: readonly string[];
  timer?: NodeJS.Timeout;
  beating: boolean;
  again: boolean;
};

// One row per stream, so a visitor's tabs and reloads come and go on their own.
// Each replica sees only its own streams, so Turso holds everyone's.
const presence = () =>
  getGlobal<Presence>("presence", () => ({
    streams: new Map(),
    left: new Set(),
    listeners: new Set(),
    here: [],
    beating: false,
    again: false,
  }));

function publish(state: Presence, here: readonly string[]): void {
  if (here.join("\n") === state.here.join("\n")) return;
  state.here = here;
  for (const listener of state.listeners) listener(here);
}

// Writes this replica's streams in one batch, so a stream's upserts and delete land in order.
// Upserts, so a row that expired while heartbeats failed comes back.
async function beat(state: Presence): Promise<void> {
  const now = Date.now();
  const left = new Set(state.left);
  try {
    const [, , , { rows }] = await batch([
      {
        // WHERE true keeps SQLite from reading ON CONFLICT as a join constraint.
        sql: `INSERT INTO presence (stream, username, seen_at)
              SELECT key, value, ? FROM json_each(?) WHERE true
              ON CONFLICT (stream) DO UPDATE SET seen_at = excluded.seen_at`,
        args: [now, JSON.stringify(Object.fromEntries(state.streams))],
      },
      {
        sql: "DELETE FROM presence WHERE stream IN (SELECT value FROM json_each(?))",
        args: [JSON.stringify([...left])],
      },
      {
        sql: "DELETE FROM presence WHERE seen_at <= ?",
        args: [now - EXPIRY_MS],
      },
      { sql: "SELECT DISTINCT username FROM presence ORDER BY username" },
    ]);
    for (const stream of left) state.left.delete(stream);
    if (state.listeners.size > 0) {
      const here = rows.map((row) => String(row["username"]));
      publish(state, here);
    } else if (state.left.size === 0) {
      clearInterval(state.timer);
      state.timer = undefined;
      state.here = [];
    }
  } catch (err) {
    log.warn({ err }, "Presence heartbeat failed");
  }
}

// A heartbeat asked for while one runs follows it, rather than racing it.
async function heartbeat(state: Presence): Promise<void> {
  if (state.beating) {
    state.again = true;
    return;
  }
  state.beating = true;
  do {
    state.again = false;
    await beat(state);
  } while (state.again);
  state.beating = false;
}

/** Counts `username` as here until the stream leaves, and tells `listener` who is here now and on every change. */
export function joinPresence(
  username: Username | undefined,
  listener: Listener,
): () => void {
  const state = presence();
  const stream = crypto.randomUUID();
  state.listeners.add(listener);
  listener(state.here);
  if (username) state.streams.set(stream, username);
  // Someone without a name changes nothing, and is told on the next beat if one is running.
  if (username || !state.timer) void heartbeat(state);
  state.timer ??= setInterval(
    () => void heartbeat(state),
    HEARTBEAT_MS,
  ).unref();

  return () => {
    state.listeners.delete(listener);
    if (!state.streams.delete(stream)) return;
    state.left.add(stream);
    void heartbeat(state);
  };
}
