import { http, HttpResponse, type JsonBodyType } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { log } from "@/lib/log";
import { server } from "@/mocks/node";

import { batch, keepWarm, query } from "./turso";

const PIPELINE_URL = "https://test-db.turso.io/v2/pipeline";

function pipelineBody(response: Record<string, unknown>) {
  return {
    results: [
      { type: "ok", response },
      { type: "ok", response: { type: "close" } },
    ],
  };
}

function pipelineResponse(result: Record<string, unknown> = {}) {
  return pipelineBody({
    type: "execute",
    result: {
      cols: [],
      rows: [],
      affected_row_count: 0,
      last_insert_rowid: null,
      ...result,
    },
  });
}

function capture(body: JsonBodyType = pipelineResponse()) {
  const requests: { body: unknown; headers: Headers }[] = [];
  server.use(
    http.post(PIPELINE_URL, async ({ request }) => {
      requests.push({ body: await request.json(), headers: request.headers });
      return HttpResponse.json(body);
    }),
  );
  return requests;
}

describe("query", () => {
  it("should send the statement with encoded args and the auth header", async () => {
    const requests = capture();

    await query({ sql: "SELECT ?, ?, ?, ?", args: ["text", 42, 1.5, null] });

    expect(requests[0]?.headers.get("authorization")).toBe(
      "Bearer test-turso-token",
    );
    expect(requests[0]?.headers.get("content-type")).toBe("application/json");
    expect(requests[0]?.body).toEqual({
      requests: [
        {
          type: "execute",
          stmt: {
            sql: "SELECT ?, ?, ?, ?",
            args: [
              { type: "text", value: "text" },
              { type: "integer", value: "42" },
              { type: "float", value: 1.5 },
              { type: "null" },
            ],
          },
        },
        { type: "close" },
      ],
    });
  });

  it("should decode rows into objects keyed by column name", async () => {
    capture(
      pipelineResponse({
        cols: [
          { name: "id" },
          { name: "name" },
          { name: "score" },
          { name: "missing" },
          { name: null },
        ],
        rows: [
          [
            { type: "integer", value: "7" },
            { type: "text", value: "seven" },
            { type: "float", value: 0.5 },
            { type: "null" },
            { type: "blob", base64: "AQI=" },
            { type: "text", value: "extra" },
          ],
        ],
        affected_row_count: 1,
        last_insert_rowid: "7",
      }),
    );

    await expect(
      query({ sql: "SELECT 1", rows: z.unknown() }),
    ).resolves.toEqual({
      rows: [
        {
          id: 7,
          name: "seven",
          score: 0.5,
          missing: null,
          4: "AQI=",
          5: "extra",
        },
      ],
      rowsAffected: 1,
      lastInsertRowId: 7,
    });
  });

  it("should return the rows as the schema parses them", async () => {
    capture(
      pipelineResponse({
        cols: [{ name: "at" }],
        rows: [[{ type: "integer", value: "7" }]],
      }),
    );

    const { rows } = await query({
      sql: "SELECT 1",
      rows: z.object({ at: z.number().transform((ms) => new Date(ms)) }),
    });

    expect(rows).toEqual([{ at: new Date(7) }]);
  });

  it("should throw when a row doesn't match the schema", async () => {
    capture(
      pipelineResponse({ cols: [{ name: "at" }], rows: [[{ type: "null" }]] }),
    );

    await expect(
      query({ sql: "SELECT 1", rows: z.object({ at: z.number() }) }),
    ).rejects.toThrow("Turso rows didn't match in SELECT 1");
  });

  it("should throw when a statement without a schema returns rows", async () => {
    capture(
      pipelineResponse({
        cols: [{ name: "n" }],
        rows: [[{ type: "integer", value: "1" }]],
      }),
    );

    await expect(query({ sql: "SELECT 1" })).rejects.toThrow(
      "Turso returned rows without a schema in SELECT 1",
    );
  });

  it("should throw on HTTP errors", async () => {
    server.use(
      http.post(PIPELINE_URL, () =>
        HttpResponse.text("nope", { status: 500, statusText: "Server Error" }),
      ),
    );

    await expect(query({ sql: "SELECT 1" })).rejects.toThrow(
      "Turso API error: 500 Server Error",
    );
  });

  it("should throw on statement errors", async () => {
    capture({
      results: [
        { type: "error", error: { message: "no such table: nope" } },
        { type: "ok", response: { type: "close" } },
      ],
    });

    await expect(query({ sql: "SELECT * FROM nope" })).rejects.toThrow(
      "Turso query error: no such table: nope",
    );
  });

  it("should throw when the first result is not an execute result", async () => {
    capture({ results: [{ type: "ok", response: { type: "close" } }] });

    await expect(query({ sql: "SELECT 1" })).rejects.toThrow(
      "Turso returned unexpected close result",
    );
  });

  it("should throw when the response has no results", async () => {
    capture({ results: [] });

    await expect(query({ sql: "SELECT 1" })).rejects.toThrow(
      "Turso returned no results",
    );
  });

  it.each(["libsql", "turso"])(
    "should rewrite %s URLs to https",
    async (scheme) => {
      vi.stubEnv("TURSO_DATABASE_URL", `${scheme}://other-db.turso.io/`);
      vi.resetModules();
      const { query: freshQuery } = await import("./turso");

      server.use(
        http.post("https://other-db.turso.io/v2/pipeline", () =>
          HttpResponse.json(pipelineResponse()),
        ),
      );

      await expect(freshQuery({ sql: "SELECT 1" })).resolves.toMatchObject({
        rows: [],
      });
    },
  );
});

describe("batch", () => {
  // A step without a value returns no rows, as BEGIN, COMMIT and writes do.
  function stmtResult(value?: number) {
    return {
      cols: [{ name: "n" }],
      rows:
        value === undefined
          ? []
          : [[{ type: "integer", value: String(value) }]],
      affected_row_count: 0,
      last_insert_rowid: null,
    };
  }

  function batchResponse(
    stepResults: unknown[],
    stepErrors: unknown[] = stepResults.map(() => null),
  ) {
    return pipelineBody({
      type: "batch",
      result: { step_results: stepResults, step_errors: stepErrors },
    });
  }

  it("should run the statements in one transaction that rolls back on failure", async () => {
    const requests = capture(
      batchResponse([
        stmtResult(),
        stmtResult(1),
        stmtResult(),
        stmtResult(),
        null,
      ]),
    );

    await expect(
      batch([
        { sql: "SELECT ?", args: [1], rows: z.object({ n: z.number() }) },
        { sql: "DELETE FROM t" },
      ]),
    ).resolves.toEqual([
      { rows: [{ n: 1 }], rowsAffected: 0, lastInsertRowId: null },
      { rows: [], rowsAffected: 0, lastInsertRowId: null },
    ]);
    expect(requests[0]?.body).toEqual({
      requests: [
        {
          type: "batch",
          batch: {
            steps: [
              { stmt: { sql: "BEGIN" } },
              {
                condition: { type: "ok", step: 0 },
                stmt: {
                  sql: "SELECT ?",
                  args: [{ type: "integer", value: "1" }],
                },
              },
              {
                condition: { type: "ok", step: 1 },
                stmt: { sql: "DELETE FROM t", args: [] },
              },
              { condition: { type: "ok", step: 2 }, stmt: { sql: "COMMIT" } },
              {
                condition: { type: "not", cond: { type: "ok", step: 3 } },
                stmt: { sql: "ROLLBACK" },
              },
            ],
          },
        },
        { type: "close" },
      ],
    });
  });

  it.each([
    { failed: 0, step: "BEGIN" },
    { failed: 2, step: "statement 2" },
    { failed: 3, step: "COMMIT" },
  ])("should name the step that failed: $step", async ({ failed, step }) => {
    // BEGIN, two statements, COMMIT and ROLLBACK.
    const steps = Array.from({ length: 5 }, (_, index) => index);
    capture(
      batchResponse(
        steps.map((index) =>
          index < failed || index === 4 ? stmtResult() : null,
        ),
        steps.map((index) =>
          index === failed ? { message: "database is locked" } : null,
        ),
      ),
    );

    await expect(
      batch([{ sql: "SELECT 1" }, { sql: "SELECT 2" }]),
    ).rejects.toThrow(`Turso query error in ${step}: database is locked`);
  });

  it("should throw when a step has neither a result nor an error", async () => {
    capture(batchResponse([stmtResult(), null, stmtResult(), null]));

    await expect(batch([{ sql: "SELECT 1" }])).rejects.toThrow(
      "Turso query error in statement 1: no result",
    );
  });

  it("should name the statement whose rows don't match its schema", async () => {
    capture(batchResponse([stmtResult(), stmtResult(1), stmtResult(), null]));

    await expect(
      batch([{ sql: "SELECT 1", rows: z.object({ n: z.string() }) }]),
    ).rejects.toThrow("Turso rows didn't match in statement 1");
  });

  it("should throw when the result is not a batch result", async () => {
    capture(pipelineResponse());

    await expect(batch([{ sql: "SELECT 1" }])).rejects.toThrow(
      "Turso returned unexpected execute result",
    );
  });
});

describe("keepWarm", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
  });

  it("should query Turso every minute", async () => {
    const statements = capture();

    keepWarm();
    keepWarm();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(59_999);
    expect(statements).toHaveLength(0);

    vi.advanceTimersByTime(1);
    await vi.waitFor(() => expect(statements).toHaveLength(1));
    expect(statements[0]?.body).toEqual({
      requests: [
        { type: "execute", stmt: { sql: "SELECT 1", args: [] } },
        { type: "close" },
      ],
    });

    vi.advanceTimersByTime(60_000);
    await vi.waitFor(() => expect(statements).toHaveLength(2));
  });

  it("should log a failed query and keep going", async () => {
    server.use(
      http.post(PIPELINE_URL, () => new HttpResponse(null, { status: 503 })),
    );

    keepWarm();
    vi.advanceTimersByTime(60_000);

    await vi.waitFor(() =>
      expect(log.warn).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        "Turso keep-warm query failed",
      ),
    );
  });
});
