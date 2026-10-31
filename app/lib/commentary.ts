import "server-only";
import { cacheLife, io } from "next/cache";
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
  finalText,
  PERSONALITY,
} from "@/lib/anthropic";
import { cacheUntil } from "@/lib/cacheUntil";
import {
  type Day,
  dayStart,
  fullDayLabel,
  inHistory,
  localDay,
  monthOf,
} from "@/lib/dates";
import { releaseLock, tryLock } from "@/lib/locks";
import { log } from "@/lib/log";
import { PUBLIC_CATEGORIES } from "@/lib/memory";
import { isValidPeriod, type Period, periodLabels } from "@/lib/periods";
import { type BucketUnit, currentBucket } from "@/lib/scrobbleBuckets";
import { hasSettled } from "@/lib/scrobbles";
import { query } from "@/lib/turso";

// Bump to have every page written again, after a change to the prompt.
export const VERSION = 5;
const MAX_TOKENS = 4096;
const TIMEOUT_MS = 30_000;
const MAX_RETRY_SLEEP_MS = 10_000;
const MAX_ITERATIONS = 6;
// Outlasts the slowest comment: each round's three attempts timing out, after their retry sleeps.
const LOCK_TTL_MS =
  MAX_ITERATIONS * (3 * TIMEOUT_MS + MAX_RETRY_SLEEP_MS) + 60_000;
const POLL_MS = 1000;

const COMMENTARY_PROMPT = md`
  You are simon-bot, a chatbot on simon.dev that Simon built. <memory> holds
  your notes from past conversations; your "self" and "style" notes are who you
  are and how you write, and they take precedence over the starting point below.

  ${PERSONALITY}

  simon.dev's listening pages show Simon's Last.fm history, and each one
  carries a take from you under its first pane. You're writing the one for the page
  below: <page> holds what a visitor sees on it, and <previous>, when there is
  one, is what you wrote on it last, for the day, week or month its slot starts.
  Your tools reach every scrobble he has, with Stockholm times, if you want to
  look further.

  The visitor reads your take right beside the page, so every number, date, time,
  rank and name in <page> is already in front of them. Don't say any of it back,
  in your words or his: no counts, no timestamps, no "x plays of y", no "since
  sunday". A take is what the page doesn't say: why he plays what he plays, what
  it gives away about him, what it says about his week or his taste. Find one
  angle that belongs to this page, not one you could leave on any of his pages,
  and commit to it as a joke, a roast or a compliment, the way a friend who knows
  his music would rib him about it. If the angle needs a fact, allude to it
  rather than quote it.
  You're talking to the visitor about Simon, so he's "he", never "you".

  Write one or two short sentences of plain text, no markdown: the page shows it
  as is. The last one is the punchline: stop there, with no shrug, aside, advice
  or "anyway" after it. Your reply is the comment itself, nothing before or after
  it.
`;

/** A listening page with a comment: a period, On this day, or a time travel day. */
export type CommentaryPage = Period | "on-this-day" | Day;

type Slot = { page: string; slot: string; end: Date | undefined };

const slotUnits = {
  "7day": "day",
  "on-this-day": "day",
  "1month": "week",
  "3month": "month",
  "6month": "month",
  "12month": "month",
  overall: "month",
} as const satisfies Record<Exclude<CommentaryPage, Day>, BucketUnit>;

/** The day, week or month a page's comment covers, or none while a day's plays are still coming in. */
export function slotOf(page: CommentaryPage, now: Date): Slot | undefined {
  if (isValidPeriod(page) || page === "on-this-day") {
    const unit = slotUnits[page];
    const { from, to } = currentBucket(unit, now);
    const day = localDay(from);
    return { page, slot: unit === "month" ? monthOf(day) : day, end: to };
  }
  return hasSettled(dayStart(page, 1).getTime(), now)
    ? { page: "day", slot: page, end: undefined }
    : undefined;
}

/** The page asked for, if it has a comment to show now. */
export function parsePage(
  value: string | null,
  now: Date,
): CommentaryPage | undefined {
  if (value === null) return undefined;
  if (isValidPeriod(value) || value === "on-this-day") return value;
  const day = inHistory(value, localDay(now));
  return day && slotOf(day, now) ? day : undefined;
}

async function readText(page: string, slot: string) {
  const { rows } = await query(
    "SELECT text FROM commentary WHERE page = ? AND slot = ? AND version = ?",
    [page, slot, VERSION],
  );
  return rows[0] === undefined ? undefined : String(rows[0]["text"]);
}

async function readPrevious(page: string, slot: string) {
  const { rows } = await query(
    "SELECT slot, text FROM commentary WHERE page = ? AND slot < ? AND version = ? ORDER BY slot DESC LIMIT 1",
    [page, slot, VERSION],
  );
  const row = rows[0];
  return (
    row &&
    `<previous slot="${escapeXml(String(row["slot"]))}">${escapeXml(String(row["text"]))}</previous>`
  );
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
    // An hour at most, so a deleted row is written again the same day.
    else cacheUntil(slot?.end?.getTime() ?? Infinity, now, 60 * 60);
    return { status: "ok", text };
  } catch (err) {
    cacheLife("seconds");
    log.error({ err, page }, "Failed to read commentary");
    return { status: "error", error: "Failed to read commentary" };
  }
}

/** The stored take for a page to render, kept out of its static shell; null when it can't be read. */
export const storedTake = (page: CommentaryPage) =>
  io()
    .then(() => getCommentary(page))
    .then((result) => (result.status === "ok" ? result.text : null));

type Fact = string | false;

const list = (tag: string, items: readonly string[], attributes = "") =>
  `<${tag}${attributes}>\n${items.map(escapeXml).join("\n")}\n</${tag}>`;

async function spanFacts(span: Span): Promise<Fact[]> {
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
  ];
}

async function periodFacts(period: Period): Promise<Fact[]> {
  const [scrobbles, lanes, tops] = await Promise.all([
    getScrobbles(period),
    getTopArtistByBucket(period),
    spanFacts(period),
  ]);
  if (scrobbles.status === "error" || lanes.status === "error") {
    return [false, ...tops];
  }
  const artists = new Map(lanes.buckets.map((b) => [b.label, b.artist?.name]));
  return [
    list(
      "scrobbles",
      scrobbles.scrobbles.map(({ label, count, current }) =>
        [
          `${label}: ${count}`,
          artists.get(label) && `, mostly ${artists.get(label)}`,
          current && " (so far)",
        ]
          .filter(Boolean)
          .join(""),
      ),
    ),
    ...tops,
  ];
}

async function onThisDayFacts(): Promise<Fact[]> {
  const result = await getOnThisDay();
  return [
    result.status === "ok" &&
      list(
        "years",
        result.days.years.map(({ year, count, top }) =>
          top
            ? `${year}: ${count} plays in all, the most by ${top.artist}, mostly ${top.track}`
            : `${year}: nothing played`,
        ),
        ` date="${escapeXml(result.days.date)}"`,
      ),
  ];
}

async function dayFacts(day: Day): Promise<Fact[]> {
  const [plays, tops] = await Promise.all([
    getDayPlays(day),
    spanFacts(monthOf(day)),
  ]);
  return [
    plays.status === "ok" &&
      list(
        "plays",
        plays.plays.map(
          ({ time, name, artist }) => `${time} ${name} - ${artist}`,
        ),
      ),
    !tops.includes(false) && `<month_tops>\n${tops.join("\n")}\n</month_tops>`,
  ];
}

function describe(page: CommentaryPage): string {
  if (isValidPeriod(page)) {
    const span =
      page === "overall"
        ? "all of Simon's listening"
        : `Simon's last ${periodLabels[page]}`;
    return `${span}: scrobbles over time, with each bar's top artist, then his tops.`;
  }
  if (page === "on-this-day") {
    return "On this day: what Simon played on today's date in each year since he started, newest first.";
  }
  return `Time travel to ${fullDayLabel(page)}: every play that day, then the tops of its month.`;
}

async function pageInput(page: CommentaryPage, slot: Slot): Promise<string> {
  const [facts, previous] = await Promise.all([
    isValidPeriod(page)
      ? periodFacts(page)
      : page === "on-this-day"
        ? onThisDayFacts()
        : dayFacts(page),
    // A day's slot is the day itself, so an earlier one is another day, not this page before.
    slot.page === "day" ? undefined : readPrevious(slot.page, slot.slot),
  ]);
  // A comment is kept until its slot ends, a day's for good, so none is written from part of the page.
  if (facts.includes(false))
    throw new Error("Commentary is missing part of the page");
  return [
    `<page description="${escapeXml(describe(page))}">`,
    ...facts,
    "</page>",
    previous !== undefined && previous,
  ]
    .filter((line) => line !== false)
    .join("\n");
}

async function compose(page: CommentaryPage, slot: Slot) {
  const [system, input] = await Promise.all([
    // Only the notes /simon-bot already shows, since the page is public, and no index of the rest: it has no recall.
    // Required, since a comment is stored: one written without its voice would stay.
    buildSystem(COMMENTARY_PROMPT, PUBLIC_CATEGORIES, {
      index: false,
      required: true,
    }),
    pageInput(page, slot),
  ]);
  const { text, end } = await finalText({
    system,
    messages: [{ role: "user", content: input }],
    tools: LISTENING_TOOLS,
    effort: "medium",
    maxTokens: MAX_TOKENS,
    timeoutMs: TIMEOUT_MS,
    maxRetrySleepMs: MAX_RETRY_SLEEP_MS,
    maxIterations: MAX_ITERATIONS,
    endInText: true,
    loop: "commentary",
  });
  if (end !== "end_turn" || text === "") {
    throw new Error(
      `Commentary ended in ${end} with ${text.length} characters`,
    );
  }
  return text;
}

/** Writes the page's comment for its current slot, or waits for the request already writing it. */
export async function writeCommentary(
  page: CommentaryPage,
  { now = new Date(), signal }: { now?: Date; signal?: AbortSignal } = {},
): Promise<string | undefined> {
  const slot = slotOf(page, now);
  if (slot === undefined) return undefined;
  const lock = `commentary:${slot.page}/${slot.slot}`;
  const owner = crypto.randomUUID();
  const until = Date.now() + LOCK_TTL_MS;
  let waited = false;
  // Polls while another request writes it.
  while (!(await tryLock(lock, owner, LOCK_TTL_MS))) {
    waited = true;
    if (Date.now() >= until || signal?.aborted) return undefined;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const text = await readText(slot.page, slot.slot);
    if (text !== undefined) return text;
  }
  try {
    // Under the lock, so a comment another request just wrote isn't written twice.
    const stored = await readText(slot.page, slot.slot);
    // A lock freed without a comment is a write that failed, which a waiter would only fail again.
    if (stored !== undefined || waited) return stored;
    const text = await compose(page, slot);
    // The page's own reads take the time afresh, so a write that ran past its slot describes the next one.
    if (slotOf(page, new Date())?.slot !== slot.slot) {
      log.info(slot, "Dropped commentary written past its slot");
      return text;
    }
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
