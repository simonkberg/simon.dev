import "server-only";
import { getGlobal } from "@/lib/global";
import { log } from "@/lib/log";
import type { Username } from "@/lib/session";
import { batch, type Statement } from "@/lib/turso";

const HEARTBEAT_MS = 15_000;
// Three heartbeats, so one slow request doesn't drop anyone.
const EXPIRY_MS = 45_000;

type Listener = (here: readonly string[]) => void;

type Presence = {
  streams: Map<string, number>;
  listeners: Set<Listener>;
  stored: readonly string[];
  here: readonly string[];
  timer?: NodeJS.Timeout;
};

// Each replica sees only its own streams, so Turso holds everyone's.
const presence = () =>
  getGlobal<Presence>("presence", () => ({
    streams: new Map(),
    listeners: new Set(),
    stored: [],
    here: [],
  }));

function publish(state: Presence): void {
  const here = [...new Set([...state.stored, ...state.streams.keys()])].sort();
  if (here.join("\n") === state.here.join("\n")) return;
  state.here = here;
  for (const listener of state.listeners) listener(here);
}

function upsert(usernames: readonly string[], now: number): Statement[] {
  if (usernames.length === 0) return [];
  return [
    {
      sql: `INSERT INTO presence (username, seen_at) VALUES ${usernames.map(() => "(?, ?)").join(", ")}
            ON CONFLICT (username) DO UPDATE SET seen_at = excluded.seen_at`,
      args: usernames.flatMap((username) => [username, now]),
    },
  ];
}

async function heartbeat(state: Presence): Promise<void> {
  const now = Date.now();
  try {
    const results = await batch([
      ...upsert([...state.streams.keys()], now),
      {
        sql: "DELETE FROM presence WHERE seen_at <= ?",
        args: [now - EXPIRY_MS],
      },
      { sql: "SELECT username FROM presence" },
    ]);
    state.stored = (results.at(-1)?.rows ?? []).map((row) =>
      String(row["username"]),
    );
    publish(state);
  } catch (err) {
    log.warn({ err }, "Presence heartbeat failed");
  }
}

/** Counts `username` as here until it leaves, and tells `listener` who is here now and on every change. */
export function joinPresence(
  username: Username | undefined,
  listener: Listener,
): () => void {
  const state = presence();
  if (username) {
    state.streams.set(username, (state.streams.get(username) ?? 0) + 1);
  }
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
    if (username) {
      const streams = (state.streams.get(username) ?? 1) - 1;
      if (streams > 0) state.streams.set(username, streams);
      else state.streams.delete(username);
    }

    if (state.listeners.size > 0) return publish(state);
    clearInterval(state.timer);
    state.timer = undefined;
    state.stored = [];
    state.here = [];
  };
}
