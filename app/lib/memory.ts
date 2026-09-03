import "server-only";
import { z } from "zod";

import { log } from "@/lib/log";
import { query, type Value } from "@/lib/turso";

export const CORE_CATEGORIES = ["self", "style", "interests"] as const;
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

export async function forget(id: number): Promise<boolean> {
  const { rowsAffected } = await query("DELETE FROM memories WHERE id = ?", [
    id,
  ]);
  return rowsAffected > 0;
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
