import "server-only";
import { config } from "@/config";
import { getGlobal } from "@/lib/global";
import {
  bulk,
  type ChartItem,
  type ChartKind,
  userGetLovedTracks,
  userGetScrobbles,
} from "@/lib/lastfm";
import { tryLock } from "@/lib/locks";
import { log } from "@/lib/log";
import { batch, query, type Statement, type Value } from "@/lib/turso";

const PAGE = 200;
const LOVED_PAGE = 1000;
const SYNC_MS = 60_000;
// Outlasts a sync, so the replica holding it keeps it from one to the next.
const LOCK_TTL_MS = 3 * 60_000;
const LOCK_NAME = "scrobbles";
// Long enough to backfill in bulk, short enough that new scrobbles still arrive each minute.
const BACKFILL_SLICE_MS = 50_000;
// Last.fm takes scrobbles up to two weeks old, so an offline player's arrive late.
const LATE_MS = 14 * 24 * 60 * 60_000;

type Tracks = Awaited<ReturnType<typeof userGetScrobbles>>["tracks"];

type State = { owner: string; backfilled: boolean; drift: number };

function state(): State {
  return getGlobal("scrobble-sync", () => ({
    owner: crypto.randomUUID(),
    backfilled: false,
    drift: 0,
  }));
}

function fetchPage(params: {
  from: Date;
  to: Date;
  page?: number;
  limit?: number;
}) {
  return bulk(() =>
    userGetScrobbles(config.lastfmUsername, { limit: PAGE, ...params }),
  );
}

function insertRows(into: string, rows: Value[][]): Statement {
  return {
    sql: `INSERT OR IGNORE INTO ${into}
          VALUES ${rows.map((row) => `(${row.map(() => "?").join(", ")})`).join(", ")}`,
    args: rows.flat(),
  };
}

async function store(tracks: Tracks): Promise<void> {
  if (tracks.length === 0) return;
  const { sql, args } = insertRows(
    "scrobbles (played_at, artist, track, album)",
    tracks.map(({ playedAt, artist, name, album }) => [
      playedAt.getTime(),
      artist,
      name,
      album,
    ]),
  );
  await query(sql, args);
}

async function storedEdge(edge: "MIN" | "MAX"): Promise<number | undefined> {
  const { rows } = await query(
    `SELECT ${edge}(played_at) AS played_at FROM scrobbles`,
  );
  const playedAt = rows[0]?.["played_at"];
  return typeof playedAt === "number" ? playedAt : undefined;
}

const toSecond = (ms: number) => ms - (ms % 1000);

/** Stores a range's pages oldest first, so one cut short leaves no gap below the newest stored. */
async function refetch(range: { from: Date; to: Date }): Promise<void> {
  const first = await fetchPage(range);
  for (let page = Math.ceil(first.total / PAGE); page > 1; page--) {
    await store((await fetchPage({ ...range, page })).tracks);
  }
  await store(first.tracks);
}

async function catchUp(current: State): Promise<void> {
  const newest = await storedEdge("MAX");
  if (newest === undefined) return;
  // A fixed `to`, so scrobbles arriving meanwhile don't shift the pages.
  const to = toSecond(Date.now());
  const from = Math.min(newest, toSecond(to - LATE_MS));
  const window = { from: new Date(from), to: new Date(to) };
  const countStored = () => countScrobbles(window.from, window.to);
  const [{ total }, stored] = await Promise.all([
    fetchPage({ ...window, limit: 1 }),
    countStored(),
  ]);
  if (total - stored === current.drift) return;
  // New scrobbles usually all follow the newest stored, so those come first.
  await refetch({ from: new Date(newest), to: window.to });
  if (total - (await countStored()) === current.drift) return;
  await refetch(window);
  // What a refetch can't settle, like a same-second repeat or a deletion, so it isn't refetched each minute.
  current.drift = total - (await countStored());
}

function fetchLovedPage(page: number) {
  return bulk(() =>
    userGetLovedTracks(config.lastfmUsername, { limit: LOVED_PAGE, page }),
  );
}

async function lovedTracks() {
  const { totalPages, tracks } = await fetchLovedPage(1);
  for (let page = 2; page <= totalPages; page++) {
    tracks.push(...(await fetchLovedPage(page)).tracks);
  }
  return tracks;
}

type Love = { artist: string; track: string; lovedAt: number };

const loveKey = ({ artist, track, lovedAt }: Love) =>
  JSON.stringify([artist, track, lovedAt]);

function missingFrom(loves: Love[], others: Love[]): Love[] {
  const keys = new Set(others.map(loveKey));
  return loves.filter((love) => !keys.has(loveKey(love)));
}

// Last.fm lists every loved track, so an unloved one goes too; only what changed is written.
async function syncLoved(): Promise<void> {
  const [tracks, { rows }] = await Promise.all([
    lovedTracks(),
    query("SELECT artist, track, loved_at FROM loved"),
  ]);
  const listed = tracks.map(({ artist, name, lovedAt }) => ({
    artist,
    track: name,
    lovedAt: lovedAt.getTime(),
  }));
  const stored = rows.map((row) => ({
    artist: String(row["artist"]),
    track: String(row["track"]),
    lovedAt: Number(row["loved_at"]),
  }));
  const removed = missingFrom(stored, listed);
  const writes: Statement[] = removed.map(({ artist, track }) => ({
    sql: "DELETE FROM loved WHERE artist = ? AND track = ?",
    args: [artist, track],
  }));
  const added = missingFrom(listed, stored);
  if (added.length > 0) {
    writes.push(
      insertRows(
        "loved (artist, track, loved_at)",
        added.map(({ artist, track, lovedAt }) => [artist, track, lovedAt]),
      ),
    );
  }
  if (writes.length === 0) return;
  await batch(writes);
  log.info(
    { added: added.length, removed: removed.length },
    "Synced loved tracks",
  );
}

/** Stores the page before `oldest`, and returns the oldest stored after it. */
async function backfillPage(
  oldest: number | undefined,
): Promise<number | undefined> {
  // `to` is exclusive: a second past the oldest keeps others played in its second.
  const { tracks } = await fetchPage({
    from: new Date(0),
    to: new Date((oldest ?? Date.now()) + 1000),
  });
  await store(tracks);
  return tracks.at(-1)?.playedAt.getTime() ?? oldest;
}

/** Scrobbles played from `from` until `to`. */
export async function countScrobbles(from: Date, to: Date): Promise<number> {
  const { rows } = await query(
    "SELECT COUNT(*) AS count FROM scrobbles WHERE played_at >= ? AND played_at < ?",
    [from.getTime(), to.getTime()],
  );
  return Number(rows[0]?.["count"]);
}

export type Play = { artist: string; track: string };

/** What played from `from` until `to`, oldest first. */
export async function playsIn(from: Date, to: Date): Promise<Play[]> {
  const { rows } = await query(
    "SELECT artist, track FROM scrobbles WHERE played_at >= ? AND played_at < ? ORDER BY played_at, artist, track",
    [from.getTime(), to.getTime()],
  );
  return rows.map((row) => ({
    artist: String(row["artist"]),
    track: String(row["track"]),
  }));
}

export type Played = { name: string; artist: string; playcount: number };

// What each kind groups by; an artist is its own name.
const groups = {
  artist: { name: "artist", by: "artist", where: "" },
  track: { name: "track", by: "artist, track", where: "" },
  // Last.fm leaves a play's album empty when it has none, and ranks no such album.
  album: { name: "album", by: "artist, album", where: "AND album != ''" },
} as const satisfies Record<ChartKind, unknown>;

/** The most played of a kind from `from` until `to`, ties by artist, then title. */
export async function topPlayed(
  kind: ChartKind,
  from: Date,
  to: Date,
  limit: number,
): Promise<Played[]> {
  const { name, by, where } = groups[kind];
  const { rows } = await query(
    `SELECT artist, ${name} AS name, COUNT(*) AS plays FROM scrobbles
     WHERE played_at >= ? AND played_at < ? ${where}
     GROUP BY ${by} ORDER BY plays DESC, ${by} LIMIT ?`,
    [from.getTime(), to.getTime(), limit],
  );
  return rows.map((row) => ({
    name: String(row["name"]),
    artist: String(row["artist"]),
    playcount: Number(row["plays"]),
  }));
}

/** The most played artists from `from` until `to`, first by name on a tie. */
export async function topArtists(
  from: Date,
  to: Date,
  limit: number,
): Promise<ChartItem[]> {
  const top = await topPlayed("artist", from, to, limit);
  // An artist is its own name.
  return top.map(({ name, playcount }) => ({ name, playcount }));
}

export async function topArtist(
  from: Date,
  to: Date,
): Promise<ChartItem | undefined> {
  const [top] = await topArtists(from, to, 1);
  return top;
}

/** Brings the mirror up to date and backfills for a while; resolves whether history remains. */
export async function syncScrobbles(): Promise<boolean> {
  const current = state();
  if (!(await tryLock(LOCK_NAME, current.owner, LOCK_TTL_MS))) return false;

  await catchUp(current);
  if (current.backfilled) {
    // Once a minute, not between backfill pages; a failure leaves the scrobbles synced.
    await syncLoved().catch((err: unknown) => {
      log.warn({ err }, "Failed to sync loved tracks");
    });
    return false;
  }

  const deadline = Date.now() + BACKFILL_SLICE_MS;
  let oldest = await storedEdge("MIN");
  while (!current.backfilled && Date.now() < deadline) {
    const reached = await backfillPage(oldest);
    // Not a short page: one can be short while a track plays, since Last.fm lists it in the page.
    current.backfilled = reached === oldest;
    oldest = reached;
  }
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
