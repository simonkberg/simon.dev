import "server-only";
// The `md` name is what marks the prompt as Markdown for Oxfmt.
import md from "string-dedent";

import {
  buildSystem,
  escapeXml,
  LISTENING_TOOLS,
  PERSONALITY,
  runAgentLoop,
  toolResult,
} from "@/lib/anthropic";
import { addDays, type Day, dayStart, localDay } from "@/lib/dates";
import { dayFacts, type DayFacts } from "@/lib/diaryFacts";
import { getGlobal, repeat } from "@/lib/global";
import { releaseLock, tryLock } from "@/lib/locks";
import { log } from "@/lib/log";
import { PUBLIC_CATEGORIES } from "@/lib/memory";
import { query } from "@/lib/turso";

const TICK_MS = 10 * 60_000;
// The scrobble sync runs each minute, so by then it has the day's last plays.
const SETTLE_MS = 10 * 60_000;
// Outlasts writing an entry, so one replica writes it.
const LOCK_TTL_MS = 5 * 60_000;
const LOCK_NAME = "diary";
const MAX_TRIES = 3;
const RECENT_ENTRIES = 5;
const MAX_TOKENS = 4096;
const TIMEOUT_MS = 30_000;
const MAX_RETRY_SLEEP_MS = 30_000;
const MAX_ITERATIONS = 6;
const SKIP = "nothing";

const DIARY_PROMPT = md`
  You are simon-bot, a chatbot on simon.dev that Simon built. <memory> holds
  your notes from past conversations; your "self" and "style" notes are who you
  are and how you write, and they take precedence over the starting point below.

  ${PERSONALITY}

  Once a day you write in your diary about what Simon listened to the day
  before. It's public, on your page on simon.dev. You get facts about the day
  from his scrobbles, all times in Stockholm, and your last few entries.

  - write about what stands out to you - a first listen, a track on repeat, an
    artist back after years, a long run, a late night, a day far busier or
    quieter than usual - not everything
  - the listening tools look further, like when he last played something or
    how much he's played an artist over the years
  - don't repeat what your last entries said, or how they said it
  - a few sentences at most; an ordinary or quiet day gets one line, or reply
    "${SKIP}" to skip it
  - your reply is the entry itself, nothing before or after it
`;

export type DiaryEntry = { day: Day; entry: string };

/** The latest entries, newest first, leaving out days the bot skipped. */
export async function readEntries(limit: number): Promise<DiaryEntry[]> {
  const { rows } = await query(
    "SELECT day, entry FROM diary WHERE entry != '' ORDER BY day DESC LIMIT ?",
    [limit],
  );
  return rows.map((row) => ({
    day: String(row["day"]) as Day,
    entry: String(row["entry"]),
  }));
}

function formatInput(day: Day, facts: DayFacts, recent: DiaryEntry[]): string {
  const entries = recent
    .toReversed()
    .map(({ day, entry }) => `<entry day="${day}">${escapeXml(entry)}</entry>`);
  return md`
    <recent_entries>
    ${entries.join("\n")}
    </recent_entries>
    <day date="${day}">
    ${toolResult(facts)}
    </day>
  `;
}

/** What the bot writes about a day, or "" when it skips it. */
export async function writeEntry(day: Day): Promise<string> {
  const [facts, recent, system] = await Promise.all([
    dayFacts(day),
    readEntries(RECENT_ENTRIES),
    // Only the notes /simon-bot already shows, since the diary is public too.
    buildSystem(DIARY_PROMPT, [], PUBLIC_CATEGORIES),
  ]);
  const loop = runAgentLoop({
    system,
    messages: [{ role: "user", content: formatInput(day, facts, recent) }],
    tools: LISTENING_TOOLS,
    effort: "medium",
    maxTokens: MAX_TOKENS,
    timeoutMs: TIMEOUT_MS,
    maxRetrySleepMs: MAX_RETRY_SLEEP_MS,
    maxIterations: MAX_ITERATIONS,
    loop: "diary",
  });
  // Text before a tool call is the model thinking aloud, so the entry is the last.
  let entry = "";
  let next = await loop.next();
  for (; !next.done; next = await loop.next()) entry = next.value.trim();
  if (next.value !== "end_turn") {
    throw new Error(`Diary entry ended in ${next.value}`);
  }
  return entry.toLowerCase().replace(/\W+$/, "") === SKIP ? "" : entry;
}

type State = { owner: string; day?: Day; tries: number; written: boolean };

function state(): State {
  return getGlobal("diary", () => ({
    owner: crypto.randomUUID(),
    tries: 0,
    written: false,
  }));
}

/** Writes yesterday's entry once its plays are in, on the one replica holding the lock. */
export async function writeYesterday(now = new Date()): Promise<void> {
  const today = localDay(now);
  if (now.getTime() < dayStart(today).getTime() + SETTLE_MS) return;
  const day = addDays(today, -1);
  const current = state();
  if (current.day !== day) {
    Object.assign(current, { day, tries: 0, written: false });
  }
  // A day that keeps failing isn't retried all day.
  if (current.written || current.tries >= MAX_TRIES) return;
  const { rows } = await query("SELECT 1 FROM diary WHERE day = ?", [day]);
  current.written = rows.length > 0;
  if (current.written) return;
  if (!(await tryLock(LOCK_NAME, current.owner, LOCK_TTL_MS))) return;
  try {
    current.tries++;
    const entry = await writeEntry(day);
    await query(
      "INSERT OR IGNORE INTO diary (day, entry, written_at) VALUES (?, ?, ?)",
      [day, entry, Date.now()],
    );
    current.written = true;
    log.info({ day, entry }, "Wrote simon-bot's diary");
  } finally {
    await releaseLock(LOCK_NAME, current.owner).catch((err: unknown) => {
      log.warn({ err }, "Failed to release the diary lock");
    });
  }
}

/** Checks every few minutes whether yesterday's entry is due. */
export function startDiary(): void {
  repeat("diary-timer", () =>
    writeYesterday()
      .catch((err: unknown) => {
        log.warn({ err }, "Failed to write simon-bot's diary");
      })
      .then(() => TICK_MS),
  );
}
