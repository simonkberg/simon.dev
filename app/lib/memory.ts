import "server-only";
import { z } from "zod";

import { log } from "@/lib/log";
import { likeContains } from "@/lib/sql";
import { batch, query, type Row, type Value } from "@/lib/turso";

export const CORE_CATEGORIES = {
  self: "who you are",
  style: "how you write",
  interests: "what you like",
  context: "the world you work in",
} as const;

export function describeCoreCategories(): string {
  return Object.entries(CORE_CATEGORIES)
    .map(([name, what]) => `"${name}" is ${what}`)
    .join(", ");
}
export const PEOPLE_PREFIX = "people/";
export const MAX_CONTENT_LENGTH = 300;
export const MAX_PER_CATEGORY = 25;

export const categorySchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(64)
  .regex(
    /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)?$/,
    "Use lowercase letters, digits, hyphens and underscores, with at most one slash",
  );

const LINE_BREAKS = /\r\n|[\r\n\v\f\u0085\u2028\u2029]/g;

// One line, so a note can't start a section of its own in the <memory> block.
function toOneLine(text: string): string {
  return text.replace(LINE_BREAKS, " ").trim();
}

export const contentSchema = z
  .string()
  .overwrite(toOneLine)
  .min(1)
  .max(MAX_CONTENT_LENGTH);

const COLUMNS = "id, category, content, created_at, updated_at";

const memoryRowSchema = z.object({
  id: z.number(),
  category: z.string(),
  content: z.string(),
  created_at: z.string().pipe(z.coerce.date()),
  updated_at: z.string().pipe(z.coerce.date()).nullable(),
});

export type Memory = {
  id: number;
  category: string;
  content: string;
  createdAt: Date;
  updatedAt: Date | undefined;
};

function toMemory(row: unknown): Memory {
  const parsed = memoryRowSchema.parse(row);
  return {
    id: parsed.id,
    category: parsed.category,
    content: parsed.content,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at ?? undefined,
  };
}

export function peopleCategory(username: string): string | undefined {
  const slug = username
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${PEOPLE_PREFIX}${slug}` : undefined;
}

export async function remember(input: {
  category: string;
  content: string;
}): Promise<{ status: "ok"; memory: Memory } | WriteMiss> {
  const category = categorySchema.parse(input.category);
  const content = contentSchema.parse(input.content);

  // One statement so parallel tool calls can't both slip past the cap.
  const { rows } = await query(
    `INSERT INTO memories (category, content, created_at)
     SELECT ?, ?, ?
     WHERE (SELECT COUNT(*) FROM memories WHERE category = ?) < ?
     RETURNING ${COLUMNS}`,
    [category, content, new Date().toISOString(), category, MAX_PER_CATEGORY],
  );
  const row = rows[0];
  return row === undefined
    ? { status: "full", category }
    : { status: "ok", memory: toMemory(row) };
}

export async function recall(input: {
  category?: string | undefined;
  search?: string | undefined;
  limit?: number | undefined;
}): Promise<Memory[]> {
  const conditions: string[] = [];
  const args: Value[] = [];

  if (input.category !== undefined) {
    conditions.push("category = ?");
    args.push(categorySchema.parse(input.category));
  }
  if (input.search !== undefined) {
    conditions.push("content LIKE ? ESCAPE '\\'");
    args.push(likeContains(input.search));
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM memories
     ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
    [...args, input.limit ?? 20],
  );
  return rows.map(toMemory);
}

export type WriteMiss =
  | { status: "stale"; current: Memory }
  | { status: "missing"; id: number }
  | { status: "full"; category: string };

export function describeMiss(miss: WriteMiss) {
  switch (miss.status) {
    case "missing":
      return {
        error: `There is no note #${miss.id} - it may have been forgotten already`,
      };
    case "full":
      return {
        error: `Category "${miss.category}" is full (${MAX_PER_CATEGORY} memories). Forget something first.`,
      };
    case "stale":
      return {
        error: `Note #${miss.current.id} has changed since you read it - work from its current text`,
        current: miss.current,
      };
  }
}

async function explainMiss(id: number): Promise<WriteMiss> {
  const { rows } = await query(`SELECT ${COLUMNS} FROM memories WHERE id = ?`, [
    id,
  ]);
  const row = rows[0];
  return row === undefined
    ? { status: "missing", id }
    : { status: "stale", current: toMemory(row) };
}

const LISTING_PREFIX = /^(?:-\s*)?#(\d+)\s+/;

// The listing shows notes as "- #id text"; a copy that kept the decoration
// should still match, and so should a note whose own text starts with "#id".
// Line breaks read as the spaces a write turns them into.
function asRead(id: number, text: string): [string, string] {
  const trimmed = toOneLine(text);
  const prefix = LISTING_PREFIX.exec(trimmed);
  const bare =
    prefix?.[1] === String(id) ? trimmed.slice(prefix[0].length) : trimmed;
  return [trimmed, bare];
}

// Writes only land against the exact text the caller read, so a note that
// changed under a parallel reply or reflection is never overwritten blindly.
export async function edit(input: {
  id: number;
  oldContent: string;
  newContent: string;
  category?: string | undefined;
}): Promise<{ status: "ok"; memory: Memory } | WriteMiss> {
  const newContent = contentSchema.parse(input.newContent);
  const category =
    input.category === undefined ? null : categorySchema.parse(input.category);
  const read = asRead(input.id, input.oldContent);
  // A move into another category counts against that category's cap.
  const { rows } = await query(
    `UPDATE memories
     SET content = ?, category = COALESCE(?, category),
       updated_at = CASE WHEN content = ? THEN updated_at ELSE ? END
     WHERE id = ? AND content IN (?, ?)
       AND (COALESCE(?, category) = category
         OR (SELECT COUNT(*) FROM memories WHERE category = ?) < ?)
     RETURNING ${COLUMNS}`,
    [
      newContent,
      category,
      newContent,
      new Date().toISOString(),
      input.id,
      ...read,
      category,
      category,
      MAX_PER_CATEGORY,
    ],
  );
  const row = rows[0];
  if (row !== undefined) return { status: "ok", memory: toMemory(row) };
  const miss = await explainMiss(input.id);
  const unchanged =
    miss.status === "stale" && read.includes(miss.current.content);
  return unchanged && category !== null ? { status: "full", category } : miss;
}

export async function forget(input: {
  id: number;
  content: string;
}): Promise<{ status: "ok" } | WriteMiss> {
  const { rowsAffected } = await query(
    "DELETE FROM memories WHERE id = ? AND content IN (?, ?)",
    [input.id, ...asRead(input.id, input.content)],
  );
  return rowsAffected > 0 ? { status: "ok" } : explainMiss(input.id);
}

const notesIn = (categories: readonly string[]) => ({
  sql: `SELECT ${COLUMNS} FROM memories
     WHERE category IN (${categories.map(() => "?").join(", ")})
     ORDER BY created_at, id`,
  args: [...categories],
});

const byCategory = (rows: Row[]) =>
  Map.groupBy(rows.map(toMemory), (note) => note.category);

export async function readPersonNotes(username: string): Promise<Memory[]> {
  const category = peopleCategory(username);
  if (category === undefined) return [];
  const { sql, args } = notesIn([category]);
  const { rows } = await query(sql, args);
  return rows.map(toMemory);
}

export async function forgetPerson(username: string): Promise<number> {
  const category = peopleCategory(username);
  if (category === undefined) return 0;
  const { rowsAffected } = await query(
    "DELETE FROM memories WHERE category = ?",
    [category],
  );
  return rowsAffected;
}

function renderCategory(category: string, memories: Memory[]): string {
  const lines = memories.map((memory) => `- #${memory.id} ${memory.content}`);
  return [
    `## ${category}`,
    ...(lines.length > 0 ? lines : ["(nothing yet)"]),
  ].join("\n");
}

/** The core categories and the participants' people/* in full and the rest by name, or only the categories in `only`. */
export async function buildMemoryContext(
  participants: string[],
  only?: readonly string[],
): Promise<string> {
  try {
    const people = participants
      .map(peopleCategory)
      .filter((category) => category !== undefined);
    const shown = only ?? [
      ...new Set([...Object.keys(CORE_CATEGORIES), ...people]),
    ];

    const [{ rows: memoryRows }, { rows: countRows }] = await batch([
      notesIn(shown),
      {
        sql: "SELECT category, COUNT(*) AS count FROM memories GROUP BY category ORDER BY category",
      },
    ]);

    const notes = byCategory(memoryRows);
    const sections = shown.map((category) =>
      renderCategory(category, notes.get(category) ?? []),
    );

    const others = (only ? [] : countRows)
      .filter((row) => !shown.includes(String(row["category"])))
      .map((row) => `${row["category"]} (${row["count"]})`);
    if (others.length > 0) {
      sections.push(
        `Other categories, use recall to read them: ${others.join(", ")}`,
      );
    }

    return `<memory>\n${sections.join("\n\n")}\n</memory>`;
  } catch (err) {
    log.error({ err }, "Failed to build memory context");
    return "";
  }
}

// The bot's own notes, shown on its page; people/* and context stay private.
export const PUBLIC_CATEGORIES = [
  "self",
  "style",
  "interests",
] as const satisfies (keyof typeof CORE_CATEGORIES)[];

export type PublicCategory = (typeof PUBLIC_CATEGORIES)[number];

export async function readPublicNotes(): Promise<
  Record<PublicCategory, Memory[]>
> {
  const { sql, args } = notesIn(PUBLIC_CATEGORIES);
  const notes = byCategory((await query(sql, args)).rows);
  return Object.fromEntries(
    PUBLIC_CATEGORIES.map((category) => [category, notes.get(category) ?? []]),
  ) as Record<PublicCategory, Memory[]>;
}
