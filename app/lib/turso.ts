import "server-only";
import { z } from "zod";

import { env } from "@/lib/env";

const TIMEOUT_MS = 5000;

export type Value = string | number | null;
export type Row = Record<string, Value>;
export type QueryResult = {
  rows: Row[];
  rowsAffected: number;
  lastInsertRowId: number | null;
};

const valueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("null") }),
  z.object({ type: z.literal("integer"), value: z.string() }),
  z.object({ type: z.literal("float"), value: z.number() }),
  z.object({ type: z.literal("text"), value: z.string() }),
  z.object({ type: z.literal("blob"), base64: z.string() }),
]);

const pipelineResponseSchema = z.object({
  results: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("ok"),
        response: z.discriminatedUnion("type", [
          z.object({
            type: z.literal("execute"),
            result: z.object({
              cols: z.array(z.object({ name: z.string().nullable() })),
              rows: z.array(z.array(valueSchema)),
              affected_row_count: z.number(),
              last_insert_rowid: z.string().nullable(),
            }),
          }),
          z.object({ type: z.literal("close") }),
        ]),
      }),
      z.object({
        type: z.literal("error"),
        error: z.object({ message: z.string() }),
      }),
    ]),
  ),
});

function encodeValue(value: Value) {
  if (value === null) return { type: "null" };
  if (typeof value === "string") return { type: "text", value };
  if (Number.isInteger(value)) return { type: "integer", value: String(value) };
  return { type: "float", value };
}

function decodeValue(value: z.infer<typeof valueSchema>): Value {
  switch (value.type) {
    case "null":
      return null;
    case "integer":
      return Number(value.value);
    case "float":
    case "text":
      return value.value;
    case "blob":
      return value.base64;
  }
}

function pipelineUrl(): string {
  const base = env.TURSO_DATABASE_URL.replace(
    /^(libsql|turso):/,
    "https:",
  ).replace(/\/$/, "");
  return `${base}/v2/pipeline`;
}

export async function query(
  sql: string,
  args: Value[] = [],
): Promise<QueryResult> {
  const response = await fetch(pipelineUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.TURSO_AUTH_TOKEN}`,
    },
    body: JSON.stringify({
      requests: [
        { type: "execute", stmt: { sql, args: args.map(encodeValue) } },
        { type: "close" },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Turso API error: ${response.status} ${response.statusText}`,
    );
  }

  const [result] = pipelineResponseSchema.parse(await response.json()).results;

  if (!result) {
    throw new Error("Turso returned no results");
  }
  if (result.type === "error") {
    throw new Error(`Turso query error: ${result.error.message}`);
  }
  if (result.response.type !== "execute") {
    throw new Error(`Turso returned unexpected ${result.response.type} result`);
  }

  const { cols, rows, affected_row_count, last_insert_rowid } =
    result.response.result;

  return {
    rows: rows.map((row) =>
      Object.fromEntries(
        row.map((value, index) => [
          cols[index]?.name ?? String(index),
          decodeValue(value),
        ]),
      ),
    ),
    rowsAffected: affected_row_count,
    lastInsertRowId:
      last_insert_rowid === null ? null : Number(last_insert_rowid),
  };
}
