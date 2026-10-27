import "server-only";
import { config } from "@/config";
import { getGlobal } from "@/lib/global";
import { bulk, userGetScrobbles } from "@/lib/lastfm";
import { tryLock } from "@/lib/locks";
import { log } from "@/lib/log";
import { query } from "@/lib/turso";

const PAGE = 200;
const SYNC_MS = 60_000;
// Outlasts a sync, so the replica holding it keeps it from one to the next.
const LOCK_TTL_MS = 3 * 60_000;
const LOCK_NAME = "scrobbles";
// Long enough to backfill in bulk, short enough that new scrobbles still arrive each minute.
const BACKFILL_SLICE_MS = 50_000;
// Last.fm takes scrobbles up to two weeks old, so an offline player's arrive late.
const LATE_MS = 14 * 24 * 60 * 60_000;

type Tracks = Awaited<ReturnType<typeof userGetScrobbles>>["tracks"];

function state() {
  return getGlobal("scrobble-sync", () => ({
    owner: crypto.randomUUID(),
    backfilled: false,
  }));
}

function fetchPage(params: {
  from: Date;
  to: Date;
  page?: number;
}): ReturnType<typeof userGetScrobbles> {
  return bulk(() =>
    userGetScrobbles(config.lastfmUsername, { ...params, limit: PAGE }),
  );
}

async function store(tracks: Tracks): Promise<void> {
  const rows = tracks.flatMap(({ playedAt, artist, name, album }) =>
    playedAt ? [[playedAt.getTime(), artist, name, album]] : [],
  );
  if (rows.length === 0) return;
  await query(
    `INSERT OR IGNORE INTO scrobbles (played_at, artist, track, album)
     VALUES ${rows.map(() => "(?, ?, ?, ?)").join(", ")}`,
    rows.flat(),
  );
}

async function storedEdge(edge: "MIN" | "MAX"): Promise<number | undefined> {
  const { rows } = await query(
    `SELECT ${edge}(played_at) AS played_at FROM scrobbles`,
  );
  const playedAt = rows[0]?.["played_at"];
  return typeof playedAt === "number" ? playedAt : undefined;
}

const toSecond = (ms: number) => ms - (ms % 1000);

async function catchUp(): Promise<void> {
  const newest = await storedEdge("MAX");
  if (newest === undefined) return;
  // A fixed `to`, so scrobbles arriving meanwhile don't shift the pages.
  const to = toSecond(Date.now());
  const from = Math.min(newest, toSecond(to - LATE_MS));
  const range = { from: new Date(from), to: new Date(to) };
  const first = await fetchPage(range);
  const { rows } = await query(
    "SELECT COUNT(*) AS count FROM scrobbles WHERE played_at >= ? AND played_at < ?",
    [from, to],
  );
  if (rows[0]?.["count"] === first.total) return;
  // Oldest page first, so a sync cut short leaves no gap below the newest stored.
  for (let page = Math.ceil(first.total / PAGE); page > 1; page--) {
    await store((await fetchPage({ ...range, page })).tracks);
  }
  await store(first.tracks);
}

/** Stores the page before the oldest stored scrobble, and returns whether it was the last. */
async function backfillPage(): Promise<boolean> {
  const oldest = (await storedEdge("MIN")) ?? Date.now();
  // `to` is exclusive: a second past the oldest keeps others played in its second.
  const { tracks } = await fetchPage({
    from: new Date(0),
    to: new Date(oldest + 1000),
  });
  await store(tracks);
  return tracks.length < PAGE;
}

/** Brings the mirror up to date and backfills for a while; resolves whether history remains. */
export async function syncScrobbles(): Promise<boolean> {
  const current = state();
  if (!(await tryLock(LOCK_NAME, current.owner, LOCK_TTL_MS))) return false;

  await catchUp();
  if (current.backfilled) return false;

  const deadline = Date.now() + BACKFILL_SLICE_MS;
  while (!current.backfilled && Date.now() < deadline) {
    current.backfilled = await backfillPage();
  }
  const oldest = await storedEdge("MIN");
  log.info(
    { oldest: oldest === undefined ? undefined : new Date(oldest) },
    current.backfilled ? "Backfilled every scrobble" : "Backfilling scrobbles",
  );
  return !current.backfilled;
}

/** Syncs each minute on the replica holding the lock, and back to back while backfilling. */
export function startScrobbleSync(): void {
  getGlobal("scrobble-sync-timer", () => {
    const tick = () => {
      void syncScrobbles()
        .catch((err: unknown) => {
          log.warn({ err }, "Failed to sync scrobbles");
          return false;
        })
        .then((more) => setTimeout(tick, more ? 0 : SYNC_MS).unref());
    };
    tick();
    return true;
  });
}
