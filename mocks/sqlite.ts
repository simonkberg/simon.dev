import { DatabaseSync } from "node:sqlite";

import type { query, Row } from "@/lib/turso";

// An in-memory stand-in for Turso, so tests exercise the real SQL.
export function createSqliteQuery(): typeof query {
  const db = new DatabaseSync(":memory:");
  return async (sql, args) => {
    const statement = db.prepare(sql);
    if (statement.columns().length > 0) {
      const rows = statement.all(...(args ?? [])) as Row[];
      return {
        rows,
        rowsAffected: /\breturning\b/i.test(sql) ? rows.length : 0,
        lastInsertRowId: null,
      };
    }
    const { changes, lastInsertRowid } = statement.run(...(args ?? []));
    return {
      rows: [],
      rowsAffected: Number(changes),
      lastInsertRowId: Number(lastInsertRowid),
    };
  };
}
