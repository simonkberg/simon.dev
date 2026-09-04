import "server-only";
import { z } from "zod";

import { log } from "@/lib/log";
import { query, type Value } from "@/lib/turso";

export const CORE_CATEGORIES = [
  "self",
  "style",
  "interests",
  "context",
] as const;
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

export const contentSchema = z.string().trim().min(1).max(MAX_CONTENT_LENGTH);

const memoryRowSchema = z.object({
  id: z.number(),
  category: z.string(),
  content: z.string(),
  created_at: z.string(),
});

export type Memory = {
  id: number;
  category: string;
  content: string;
  createdAt: string;
};

function toMemory(row: unknown): Memory {
  const parsed = memoryRowSchema.parse(row);
  return {
    id: parsed.id,
    category: parsed.category,
    content: parsed.content,
    createdAt: parsed.created_at,
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
}): Promise<Memory> {
  const category = categorySchema.parse(input.category);
  const content = contentSchema.parse(input.content);

  // One statement so parallel tool calls can't both slip past the cap.
  const { rows } = await query(
    `INSERT INTO memories (category, content, created_at)
     SELECT ?, ?, ?
     WHERE (SELECT COUNT(*) FROM memories WHERE category = ?) < ?
     RETURNING id, category, content, created_at`,
    [category, content, new Date().toISOString(), category, MAX_PER_CATEGORY],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error(
      `Category "${category}" is full (${MAX_PER_CATEGORY} memories). Forget something first.`,
    );
  }
  return toMemory(row);
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
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
    args.push(`%${escapeLike(input.search)}%`);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT id, category, content, created_at FROM memories
     ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
    [...args, input.limit ?? 20],
  );
  return rows.map(toMemory);
}

export type WriteMiss =
  | { status: "stale"; current: Memory }
  | { status: "missing" }
  | { status: "full"; category: string };

export function describeMiss(id: number, miss: WriteMiss) {
  switch (miss.status) {
    case "missing":
      return {
        error: `There is no note #${id} - it may have been forgotten already`,
      };
    case "full":
      return {
        error: `Category "${miss.category}" is full (${MAX_PER_CATEGORY} memories). Forget something first.`,
      };
    case "stale":
      return {
        error: `Note #${id} has changed since you read it - work from its current text`,
        current: miss.current,
      };
  }
}

async function explainMiss(id: number): Promise<WriteMiss> {
  const { rows } = await query(
    "SELECT id, category, content, created_at FROM memories WHERE id = ?",
    [id],
  );
  const row = rows[0];
  return row === undefined
    ? { status: "missing" }
    : { status: "stale", current: toMemory(row) };
}

// The listing shows notes as "- #id text"; a copy that kept the decoration
// should still match, and so should a note whose own text starts with "#id".
function asRead(id: number, text: string): [string, string] {
  const trimmed = text.trim();
  return [
    trimmed,
    trimmed.replace(new RegExp(String.raw`^(-\s*)?#${id}\s+`), ""),
  ];
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
    `UPDATE memories SET content = ?, category = COALESCE(?, category)
     WHERE id = ? AND content IN (?, ?)
       AND (? IS NULL OR ? = category
         OR (SELECT COUNT(*) FROM memories WHERE category = ?) < ?)
     RETURNING id, category, content, created_at`,
    [
      newContent,
      category,
      input.id,
      ...read,
      category,
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

function renderCategory(category: string, memories: Memory[]): string {
  const lines = memories.map((memory) => `- #${memory.id} ${memory.content}`);
  return [
    `## ${category}`,
    ...(lines.length > 0 ? lines : ["(nothing yet)"]),
  ].join("\n");
}

export async function buildMemoryContext(
  participants: string[],
): Promise<string> {
  try {
    const people = participants
      .map(peopleCategory)
      .filter((category) => category !== undefined);
    const shown = [...new Set<string>([...CORE_CATEGORIES, ...people])];

    const [{ rows: memoryRows }, { rows: countRows }] = await Promise.all([
      query(
        `SELECT id, category, content, created_at FROM memories
         WHERE category IN (${shown.map(() => "?").join(", ")})
         ORDER BY created_at, id`,
        shown,
      ),
      query(
        "SELECT category, COUNT(*) AS count FROM memories GROUP BY category ORDER BY category",
      ),
    ]);

    const byCategory = new Map<string, Memory[]>();
    for (const row of memoryRows) {
      const memory = toMemory(row);
      byCategory.set(memory.category, [
        ...(byCategory.get(memory.category) ?? []),
        memory,
      ]);
    }

    const sections = shown.map((category) =>
      renderCategory(category, byCategory.get(category) ?? []),
    );

    const others = countRows
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
