import "server-only";
import { cacheLife } from "next/cache";
// The `md` name is what marks the prompt as Markdown for Oxfmt.
import md from "string-dedent";

import {
  getDayPlays,
  getOnThisDay,
  getScrobbles,
  getTopAlbums,
  getTopArtistByBucket,
  getTopArtists,
  getTopTracks,
  type Span,
} from "@/actions/listening";
import {
  buildSystem,
  escapeXml,
  LISTENING_TOOLS,
  PERSONALITY,
  runAgentLoop,
} from "@/lib/anthropic";
import { cacheUntil } from "@/lib/cacheUntil";
import {
  addDays,
  type Day,
  dayStart,
  fullDayLabel,
  inHistory,
  localDay,
  midnight,
  monthOf,
} from "@/lib/dates";
import { releaseLock, tryLock } from "@/lib/locks";
import { log } from "@/lib/log";
import { PUBLIC_CATEGORIES } from "@/lib/memory";
import { isValidPeriod, type Period, periodLabels } from "@/lib/periods";
import { hasSettled } from "@/lib/scrobbles";
import { query } from "@/lib/turso";

// Bump to have every page written again, after a change to the prompt.
const VERSION = 1;
const MAX_TOKENS = 4096;
const TIMEOUT_MS = 30_000;
const MAX_RETRY_SLEEP_MS = 10_000;
const MAX_ITERATIONS = 6;
// Outlasts the slowest comment: every round timing out.
const LOCK_TTL_MS = 4 * 60_000;
const POLL_MS = 1000;

const COMMENTARY_PROMPT = md`
  You are simon-bot, a chatbot on simon.dev that Simon built. <memory> holds
  your notes from past conversations; your "self" and "style" notes are who you
  are and how you write, and they take precedence over the starting point below.

  ${PERSONALITY}

  simon.dev's listening pages show Simon's Last.fm history, and each one
  carries a comment from you in its corner. You're writing the one for the page
  below: <page> holds what a visitor sees on it, and <previous>, when there is
  one, is what you wrote on it last time. Your tools reach every scrobble he
  has, with Stockholm times, if you want to look further.

  Say what you make of it in two to four sentences of plain text: the page shows
  it as is. Your reply is the comment itself, nothing before or after it.
`;

/** A listening page with a comment: a period, On this day, or a time travel day. */
export type CommentaryPage = Period | "on-this-day" | Day;

export function parsePage(
  value: string | null,
  today: Day,
): CommentaryPage | undefined {
  if (value === null) return undefined;
  if (isValidPeriod(value) || value === "on-this-day") return value;
  return inHistory(value, today);
}

type Slot = { page: string; slot: string; end: Date | undefined };

function startOfWeek(day: Day): Day {
  // Weeks start on Monday.
  return addDays(day, -((new Date(day).getUTCDay() + 6) % 7));
}

function nextMonth(day: Day): Date {
  const date = new Date(day);
  return midnight(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

/** The day, week or month a page's comment covers, or none while a day's plays are still coming in. */
export function slotOf(page: CommentaryPage, now: Date): Slot | undefined {
  const today = localDay(now);
  switch (page) {
    case "7day":
    case "on-this-day":
      return { page, slot: today, end: dayStart(today, 1) };
    case "1month": {
      const monday = startOfWeek(today);
      return { page, slot: monday, end: dayStart(monday, 7) };
    }
    case "3month":
    case "6month":
    case "12month":
    case "overall":
      return { page, slot: monthOf(today), end: nextMonth(today) };
    default:
      return hasSettled(dayStart(page, 1).getTime(), now)
        ? { page: "day", slot: page, end: undefined }
        : undefined;
  }
}

async function readText(page: string, slot: string) {
  const { rows } = await query(
    "SELECT text FROM commentary WHERE page = ? AND slot = ? AND version = ?",
    [page, slot, VERSION],
  );
  return rows[0] === undefined ? undefined : String(rows[0]["text"]);
}

export type GetCommentaryResult =
  | { status: "ok"; text: string | undefined }
  | { status: "error"; error: string };

/** The stored comment for the page's current slot, if one has been written. */
export async function getCommentary(
  page: CommentaryPage,
): Promise<GetCommentaryResult> {
  "use cache";

  try {
    const now = new Date();
    const slot = slotOf(page, now);
    const text = slot && (await readText(slot.page, slot.slot));
    // A miss is reread soon, since a replica's tag can't reach the others.
    if (text === undefined) cacheLife("seconds");
    else if (slot?.end === undefined) cacheLife("max");
    else cacheUntil(slot.end.getTime(), now);
    return { status: "ok", text };
  } catch (err) {
    cacheLife("seconds");
    log.error({ err, page }, "Failed to read commentary");
    return { status: "error", error: "Failed to read commentary" };
  }
}

const list = (tag: string, items: readonly string[]) =>
  `<${tag}>\n${items.map(escapeXml).join("\n")}\n</${tag.split(" ")[0]}>`;

async function spanFacts(span: Span): Promise<string[]> {
  const [tracks, artists, albums] = await Promise.all([
    getTopTracks(span),
    getTopArtists(span),
    getTopAlbums(span),
  ]);
  return [
    tracks.status === "ok" &&
      list(
        "top_tracks",
        tracks.tracks.map(
          (t) => `${t.rank}. ${t.name} - ${t.artist}: ${t.playcount}`,
        ),
      ),
    artists.status === "ok" &&
      list(
        "top_artists",
        artists.artists.map((a) => `${a.rank}. ${a.name}: ${a.playcount}`),
      ),
    albums.status === "ok" &&
      list(
        "top_albums",
        albums.albums.map(
          (a) => `${a.rank}. ${a.name} - ${a.artist}: ${a.playcount}`,
        ),
      ),
  ].filter((fact) => fact !== false);
}

async function periodFacts(period: Period): Promise<string[]> {
  const [scrobbles, lanes, tops] = await Promise.all([
    getScrobbles(period),
    getTopArtistByBucket(period),
    spanFacts(period),
  ]);
  const artists =
    lanes.status === "ok"
      ? new Map(lanes.buckets.map((b) => [b.label, b.artist?.name]))
      : undefined;
  return [
    ...(scrobbles.status === "ok"
      ? [
          list(
            "scrobbles",
            scrobbles.scrobbles.map(({ label, count, current }) =>
              [
                `${label}: ${count}`,
                artists?.get(label) && `, mostly ${artists.get(label)}`,
                current && " (so far)",
              ]
                .filter(Boolean)
                .join(""),
            ),
          ),
        ]
      : []),
    ...tops,
  ];
}

async function onThisDayFacts(): Promise<string[]> {
  const result = await getOnThisDay();
  if (result.status === "error") return [];
  return [
    list(
      `years date="${result.days.date}"`,
      result.days.years.map(({ year, count, top }) =>
        top
          ? `${year}: ${count} plays, mostly ${top.track} - ${top.artist}`
          : `${year}: nothing played`,
      ),
    ),
  ];
}

async function dayFacts(day: Day): Promise<string[]> {
  const [plays, tops] = await Promise.all([
    getDayPlays(day),
    spanFacts(monthOf(day)),
  ]);
  return [
    ...(plays.status === "ok"
      ? [
          list(
            "plays",
            plays.plays.map(
              ({ time, name, artist }) => `${time} ${name} - ${artist}`,
            ),
          ),
        ]
      : []),
    `<month_tops>\n${tops.join("\n")}\n</month_tops>`,
  ];
}

function describe(page: CommentaryPage, today: Day): string {
  if (isValidPeriod(page)) {
    const span =
      page === "overall"
        ? "all of Simon's listening"
        : `Simon's last ${periodLabels[page]}`;
    return `${span}, today being ${fullDayLabel(today)}: scrobbles over time, with each bar's top artist, then his tops.`;
  }
  if (page === "on-this-day") {
    return "On this day: what Simon played on today's date in each year since he started, newest first.";
  }
  return `Time travel to ${fullDayLabel(page)}: every play that day, then the tops of its month.`;
}

async function pageInput(
  page: CommentaryPage,
  slot: Slot,
  now: Date,
): Promise<string> {
  const today = localDay(now);
  const [facts, previous] = await Promise.all([
    isValidPeriod(page)
      ? periodFacts(page)
      : page === "on-this-day"
        ? onThisDayFacts()
        : dayFacts(page),
    // A day's slot is the day itself, so an earlier one is another day, not this page before.
    slot.end === undefined
      ? undefined
      : query(
          "SELECT text FROM commentary WHERE page = ? AND slot < ? ORDER BY slot DESC LIMIT 1",
          [slot.page, slot.slot],
        ),
  ]);
  const last = previous?.rows[0]?.["text"];
  return [
    `<page description="${escapeXml(describe(page, today))}">`,
    ...facts,
    "</page>",
    ...(last === undefined
      ? []
      : [`<previous>${escapeXml(String(last))}</previous>`]),
  ].join("\n");
}

async function compose(page: CommentaryPage, slot: Slot, now: Date) {
  const [system, input] = await Promise.all([
    // Only the notes /simon-bot already shows, since the page is public, and no
    // index of the rest: it has no recall.
    buildSystem(COMMENTARY_PROMPT, PUBLIC_CATEGORIES, false),
    pageInput(page, slot, now),
  ]);
  const messages = [{ role: "user" as const, content: input }];
  const loop = runAgentLoop({
    system,
    messages,
    tools: LISTENING_TOOLS,
    effort: "medium",
    maxTokens: MAX_TOKENS,
    timeoutMs: TIMEOUT_MS,
    maxRetrySleepMs: MAX_RETRY_SLEEP_MS,
    maxIterations: MAX_ITERATIONS,
    endInText: true,
    loop: "commentary",
  });
  // Text before a tool call is the model thinking aloud, so the comment is the last
  // turn's text: the loop adds that turn's messages only when it calls a tool.
  let texts: string[] = [];
  let turn = messages.length;
  let next = await loop.next();
  for (; !next.done; next = await loop.next()) {
    if (messages.length !== turn) texts = [];
    texts.push(next.value);
    turn = messages.length;
  }
  if (messages.length !== turn) texts = [];
  const text = texts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  if (next.value !== "end_turn" || text === "") {
    throw new Error(
      `Commentary ended in ${next.value} with ${text.length} characters`,
    );
  }
  return text;
}

async function waitFor(slot: Slot): Promise<string | undefined> {
  const until = Date.now() + LOCK_TTL_MS;
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const text = await readText(slot.page, slot.slot);
    if (text !== undefined) return text;
  }
  return undefined;
}

/** Writes the page's comment for its current slot, or waits for the request already writing it. */
export async function writeCommentary(
  page: CommentaryPage,
  now = new Date(),
): Promise<string | undefined> {
  const slot = slotOf(page, now);
  if (slot === undefined) return undefined;
  const lock = `commentary:${slot.page}/${slot.slot}`;
  const owner = crypto.randomUUID();
  if (!(await tryLock(lock, owner, LOCK_TTL_MS))) return waitFor(slot);
  try {
    // Under the lock, so a comment another request just wrote isn't written twice.
    const stored = await readText(slot.page, slot.slot);
    if (stored !== undefined) return stored;
    const text = await compose(page, slot, now);
    await query(
      `INSERT INTO commentary (page, slot, version, text, written_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (page, slot) DO UPDATE SET version = excluded.version, text = excluded.text, written_at = excluded.written_at`,
      [slot.page, slot.slot, VERSION, text, Date.now()],
    );
    log.info({ ...slot, text }, "Wrote simon-bot's commentary");
    return text;
  } finally {
    await releaseLock(lock, owner).catch((err: unknown) => {
      log.warn({ err }, "Failed to release the commentary lock");
    });
  }
}
