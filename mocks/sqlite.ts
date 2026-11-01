import { DatabaseSync } from "node:sqlite";

import { beforeEach, vi } from "vitest";
import { z } from "zod";

import type {
  batch,
  BatchResults,
  query,
  QueryResult,
  Row,
  Value,
} from "@/lib/turso";

export const emptyResult: QueryResult = {
  rows: [],
  rowsAffected: 0,
  lastInsertRowId: null,
};

// An in-memory stand-in for Turso, so tests exercise the real SQL.
export function createSqliteQuery(setup: readonly string[] = []): typeof query {
  const db = new DatabaseSync(":memory:");
  for (const sql of setup) db.exec(sql);
  const totalChanges = db.prepare("SELECT total_changes() AS n");
  const changes = () => Number(totalChanges.get()?.["n"]);

  return async ({ sql, args = [], rows: schema }) => {
    const statement = db.prepare(sql);
    const before = changes();
    let rows: Row[] = [];
    if (statement.columns().length > 0) {
      rows = statement.all(...args) as Row[];
    } else {
      statement.run(...args);
    }
    if (!schema && rows.length > 0) {
      throw new Error(`Turso returned rows without a schema in ${sql}`);
    }
    return {
      rows: schema ? rows.map((row) => schema.parse(row)) : [],
      rowsAffected: changes() - before,
      lastInsertRowId: null,
    };
  };
}

const rowSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.null()]),
);

// Reads the test database as it stands, to assert on what the code under test wrote.
export async function selectRows(
  run: typeof query,
  sql: string,
  args?: Value[],
): Promise<Row[]> {
  return (await run({ sql, args, rows: rowSchema })).rows;
}

// Gives the mocked query a fresh database before each test; call the result for it.
export function sqliteBeforeEach(
  mocked: typeof query,
  setup: readonly string[] = [],
): () => typeof query {
  let sqlite: typeof query;
  beforeEach(() => {
    sqlite = createSqliteQuery(setup);
    vi.mocked(mocked).mockImplementation(sqlite);
  });
  return () => sqlite;
}

// Rejects statements starting with prefix and runs the rest. afterRunning
// rejects once, after the statement ran, like a response lost on the way back.
type FailOptions = { error?: Error } & (
  | { once?: boolean; afterRunning?: never }
  | { afterRunning: true; once?: never }
);

export function failQuery(
  run: typeof query,
  prefix: string,
  options: FailOptions = {},
): typeof query {
  const { error = new Error("boom") } = options;
  const afterRunning = options.afterRunning === true;
  const once = afterRunning || options.once === true;
  let failed = false;
  return async (statement) => {
    if (!statement.sql.startsWith(prefix) || (once && failed))
      return run(statement);
    if (once) failed = true;
    if (afterRunning) await run(statement);
    throw error;
  };
}

// Turso as a mock module: `batch` runs through `query`, so give `query` an implementation.
export function mockTurso(): { query: typeof query; batch: typeof batch } {
  // A mock's call signature drops the generics, though it runs the same function.
  const query = vi.fn() as typeof import("@/lib/turso").query;
  return { query, batch: vi.fn(sqliteBatch(query)) as typeof batch };
}

// Goes through the given query, so failures a test injects there reach batches too.
// Queued, since overlapping batches would nest BEGIN on the one shared connection.
export function sqliteBatch(run: typeof query): typeof batch {
  let queue: Promise<unknown> = Promise.resolve();
  return (statements) => {
    const done = queue.then(async () => {
      await run({ sql: "BEGIN" });
      try {
        const results: QueryResult<unknown>[] = [];
        for (const statement of statements) results.push(await run(statement));
        await run({ sql: "COMMIT" });
        return results as BatchResults<typeof statements>;
      } catch (err) {
        await run({ sql: "ROLLBACK" }).catch(() => {});
        throw err;
      }
    });
    queue = done.catch(() => {});
    return done;
  };
}
