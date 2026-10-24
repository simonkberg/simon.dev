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
  // One entry per open stream, so a visitor's tabs count once and leave one at a time.
  streams: string[];
  listeners: Set<Listener>;
  stored: readonly string[];
  here: readonly string[];
  timer?: NodeJS.Timeout;
  beating: boolean;
};

// Each replica sees only its own streams, so Turso holds everyone's.
const presence = () =>
  getGlobal<Presence>("presence", () => ({
    streams: [],
    listeners: new Set(),
    stored: [],
    here: [],
    beating: false,
  }));

function publish(state: Presence): void {
  const here = [...new Set([...state.stored, ...state.streams])].sort();
  if (here.join("\n") === state.here.join("\n")) return;
  state.here = here;
  for (const listener of state.listeners) listener(here);
}

async function heartbeat(state: Presence): Promise<void> {
  // A slow Turso would otherwise stack heartbeats that land out of order.
  if (state.beating) return;
  state.beating = true;
  const now = Date.now();
  try {
    const [, , { rows }] = await batch([
      {
        sql: `INSERT INTO presence (username, seen_at)
              SELECT DISTINCT value, ? FROM json_each(?) WHERE true
              ON CONFLICT (username) DO UPDATE SET seen_at = excluded.seen_at`,
        args: [now, JSON.stringify(state.streams)],
      },
      {
        sql: "DELETE FROM presence WHERE seen_at <= ?",
        args: [now - EXPIRY_MS],
      },
      { sql: "SELECT username FROM presence" },
    ]);
    // Everyone left while it ran, and the next join starts afresh.
    if (state.listeners.size === 0) return;
    state.stored = rows.map((row) => String(row["username"]));
    publish(state);
  } catch (err) {
    log.warn({ err }, "Presence heartbeat failed");
  } finally {
    state.beating = false;
  }
}

/** Counts `username` as here until it leaves, and tells `listener` who is here now and on every change. */
export function joinPresence(
  username: Username | undefined,
  listener: Listener,
): () => void {
  const state = presence();
  if (username) state.streams.push(username);
  publish(state);
  state.listeners.add(listener);
  listener(state.here);

  if (!state.timer) {
    state.timer = setInterval(
      () => void heartbeat(state),
      HEARTBEAT_MS,
    ).unref();
    void heartbeat(state);
  }

  return () => {
    state.listeners.delete(listener);
    if (username) state.streams.splice(state.streams.indexOf(username), 1);

    if (state.listeners.size > 0) return publish(state);
    clearInterval(state.timer);
    state.timer = undefined;
    state.stored = [];
    state.here = [];
  };
}
