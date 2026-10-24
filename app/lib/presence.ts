import "server-only";
import { getGlobal } from "@/lib/global";
import { log } from "@/lib/log";
import type { Username } from "@/lib/session";
import { batch, query, type Value } from "@/lib/turso";

const HEARTBEAT_MS = 15_000;
// Three heartbeats, so one slow request doesn't drop anyone.
const EXPIRY_MS = 45_000;

type Listener = (here: readonly string[]) => void;

type Presence = {
  // Stream id to username, for the streams this replica holds.
  streams: Map<string, string>;
  listeners: Set<Listener>;
  here: readonly string[];
  timer?: NodeJS.Timeout;
  // The timer whose heartbeat is running: each first join starts a new one.
  beating?: NodeJS.Timeout;
  again: boolean;
};

// One row per stream, so a visitor's tabs and reloads come and go on their own.
// Each replica sees only its own streams, so Turso holds everyone's.
const presence = () =>
  getGlobal<Presence>("presence", () => ({
    streams: new Map(),
    listeners: new Set(),
    here: [],
    again: false,
  }));

function publish(state: Presence, here: readonly string[]): void {
  if (here.join("\n") === state.here.join("\n")) return;
  state.here = here;
  for (const listener of state.listeners) listener(here);
}

async function heartbeat(state: Presence): Promise<void> {
  const { timer } = state;
  if (!timer) return;
  // A heartbeat asked for while one runs follows it, rather than racing it.
  if (state.beating === timer) {
    state.again = true;
    return;
  }
  state.beating = timer;
  state.again = false;
  const now = Date.now();
  try {
    const [, , { rows }] = await batch([
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
    // Everyone left while it ran, so a later join has its own heartbeat.
    if (state.timer !== timer) return;
    publish(
      state,
      rows.map((row) => String(row["username"])),
    );
  } catch (err) {
    log.warn({ err }, "Presence heartbeat failed");
  } finally {
    if (state.beating === timer) state.beating = undefined;
  }
  if (state.again && state.timer === timer) await heartbeat(state);
}

function write(sql: string, args: Value[]): Promise<void> {
  return query(sql, args).then(
    () => {},
    (err: unknown) => log.warn({ err }, "Presence write failed"),
  );
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

  if (!state.timer) {
    state.timer = setInterval(
      () => void heartbeat(state),
      HEARTBEAT_MS,
    ).unref();
  }

  const joined = username
    ? write(
        "INSERT INTO presence (stream, username, seen_at) VALUES (?, ?, ?)",
        [stream, username, Date.now()],
      )
    : Promise.resolve();
  if (username) state.streams.set(stream, username);
  void joined.then(() => heartbeat(state));

  return () => {
    state.listeners.delete(listener);
    if (state.streams.delete(stream)) {
      void joined.then(() =>
        write("DELETE FROM presence WHERE stream = ?", [stream]),
      );
    }
    if (state.listeners.size > 0) return;
    clearInterval(state.timer);
    state.timer = undefined;
    state.here = [];
  };
}

/** Takes a stream out at once, for a page that says it is closing before the server notices. */
export async function leavePresence(
  stream: string,
  username: Username,
): Promise<void> {
  await write("DELETE FROM presence WHERE stream = ? AND username = ?", [
    stream,
    username,
  ]);
  const state = presence();
  if (state.timer) await heartbeat(state);
}
