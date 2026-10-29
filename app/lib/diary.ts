import "server-only";
// The `md` name is what marks the prompt as Markdown for Oxfmt.
import md from "string-dedent";

import {
  buildSystem,
  CHAT_TOOLS,
  escapeXml,
  LISTENING_TOOLS,
  PERSONALITY,
  runAgentLoop,
} from "@/lib/anthropic";
import {
  addDays,
  type Day,
  dayStart,
  fullDayLabel,
  localDay,
} from "@/lib/dates";
import { getGlobal, repeat } from "@/lib/global";
import { releaseLock, tryLock } from "@/lib/locks";
import { log } from "@/lib/log";
import { PUBLIC_CATEGORIES } from "@/lib/memory";
import { query } from "@/lib/turso";

const TICK_MS = 10 * 60_000;
// The scrobble sync runs each minute, so by then it has the day's last plays.
const SETTLE_MS = 10 * 60_000;
// Outlasts the slowest entry: every round timing out and retrying.
const LOCK_TTL_MS = 30 * 60_000;
const LOCK_NAME = "diary";
const MAX_TRIES = 3;
const RECENT_ENTRIES = 5;
const MAX_TOKENS = 4096;
const TIMEOUT_MS = 30_000;
const MAX_RETRY_SLEEP_MS = 30_000;
const MAX_ITERATIONS = 10;
const SKIP = "nothing";

const DIARY_PROMPT = md`
  You are simon-bot, a chatbot on simon.dev that Simon built. <memory> holds
  your notes from past conversations; your "self" and "style" notes are who you
  are and how you write, and they take precedence over the starting point below.

  ${PERSONALITY}

  You keep a diary. It's public, on your page on simon.dev. Just after midnight
  in Stockholm you get the chance to write about the day before. Nobody hands
  you anything: your tools show what Simon played (his scrobbles, times in
  Stockholm) and what was said in the chat. Look around as long as you're
  curious, follow whatever catches your eye, then decide if anything is worth
  writing down.

  - if nothing caught your eye, reply "${SKIP}" and leave the day blank
  - it's your diary, not a report: a thought, a hunch, a connection to
    something earlier, a question you're left with, in your own words
  - don't summarize the day, and leave out counts and clock times unless one
    is the whole point
  - only state what your tools showed you; don't make up lyrics, meanings or
    facts about the music
  - no hedging: don't weigh "either this or that", and don't remark on what
    you can or can't see, or on who did or didn't ask or skip
  - don't repeat what your last entries said, or how they said it
  - one paragraph, a few sentences at most, often one
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

function formatInput(day: Day, recent: DiaryEntry[]): string {
  const entries = recent
    .toReversed()
    .map(({ day, entry }) => `<entry day="${day}">${escapeXml(entry)}</entry>`);
  return md`
    <recent_entries>
    ${entries.join("\n")}
    </recent_entries>
    <yesterday date="${day}">${fullDayLabel(day)}</yesterday>
  `;
}

/** What the bot writes about a day, or "" when it skips it. */
export async function writeEntry(day: Day): Promise<string> {
  const [recent, system] = await Promise.all([
    readEntries(RECENT_ENTRIES),
    // Only the notes /simon-bot already shows, since the diary is public too, and
    // no index of the rest: it has no recall.
    buildSystem(DIARY_PROMPT, PUBLIC_CATEGORIES, false),
  ]);
  const messages = [
    { role: "user" as const, content: formatInput(day, recent) },
  ];
  const loop = runAgentLoop({
    system,
    messages,
    tools: [...LISTENING_TOOLS, ...CHAT_TOOLS],
    effort: "medium",
    maxTokens: MAX_TOKENS,
    timeoutMs: TIMEOUT_MS,
    maxRetrySleepMs: MAX_RETRY_SLEEP_MS,
    maxIterations: MAX_ITERATIONS,
    loop: "diary",
  });
  // Text before a tool call is the model thinking aloud, so the entry is the last
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
  const entry = texts.join("").trim();
  if (next.value !== "end_turn" || entry === "") {
    throw new Error(
      `Diary entry ended in ${next.value} with ${entry.length} characters`,
    );
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
  if (!(await tryLock(LOCK_NAME, current.owner, LOCK_TTL_MS))) return;
  try {
    // Under the lock, so an entry another replica just wrote isn't written twice.
    const { rows } = await query("SELECT 1 FROM diary WHERE day = ?", [day]);
    current.written = rows.length > 0;
    if (current.written) return;
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
