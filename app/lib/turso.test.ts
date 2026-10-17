import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetGlobal } from "@/lib/global";
import { log } from "@/lib/log";
import { server } from "@/mocks/node";

import { keepWarm, query } from "./turso";

vi.mock(import("server-only"), () => ({}));

const PIPELINE_URL = "https://test-db.turso.io/v2/pipeline";

function pipelineResponse(result: Record<string, unknown> = {}) {
  return {
    results: [
      {
        type: "ok",
        response: {
          type: "execute",
          result: {
            cols: [],
            rows: [],
            affected_row_count: 0,
            last_insert_rowid: null,
            ...result,
          },
        },
      },
      { type: "ok", response: { type: "close" } },
    ],
  };
}

describe("query", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should send the statement with encoded args and the auth header", async () => {
    let body: unknown;
    server.use(
      http.post(PIPELINE_URL, async ({ request }) => {
        body = await request.json();
        expect(request.headers.get("authorization")).toBe(
          "Bearer test-turso-token",
        );
        expect(request.headers.get("content-type")).toBe("application/json");
        return HttpResponse.json(pipelineResponse());
      }),
    );

    await query("SELECT ?, ?, ?, ?", ["text", 42, 1.5, null]);

    expect(body).toEqual({
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
    server.use(
      http.post(PIPELINE_URL, () =>
        HttpResponse.json(
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
              ],
            ],
            affected_row_count: 1,
            last_insert_rowid: "7",
          }),
        ),
      ),
    );

    await expect(query("SELECT 1")).resolves.toEqual({
      rows: [{ id: 7, name: "seven", score: 0.5, missing: null, 4: "AQI=" }],
      rowsAffected: 1,
      lastInsertRowId: 7,
    });
  });

  it("should throw on HTTP errors", async () => {
    server.use(
      http.post(PIPELINE_URL, () =>
        HttpResponse.text("nope", { status: 500, statusText: "Server Error" }),
      ),
    );

    await expect(query("SELECT 1")).rejects.toThrow(
      "Turso API error: 500 Server Error",
    );
  });

  it("should throw on statement errors", async () => {
    server.use(
      http.post(PIPELINE_URL, () =>
        HttpResponse.json({
          results: [
            { type: "error", error: { message: "no such table: nope" } },
            { type: "ok", response: { type: "close" } },
          ],
        }),
      ),
    );

    await expect(query("SELECT * FROM nope")).rejects.toThrow(
      "Turso query error: no such table: nope",
    );
  });

  it("should throw when the first result is not an execute result", async () => {
    server.use(
      http.post(PIPELINE_URL, () =>
        HttpResponse.json({
          results: [{ type: "ok", response: { type: "close" } }],
        }),
      ),
    );

    await expect(query("SELECT 1")).rejects.toThrow(
      "Turso returned unexpected close result",
    );
  });

  it("should fall back to the column index when a value has no column", async () => {
    server.use(
      http.post(PIPELINE_URL, () =>
        HttpResponse.json(
          pipelineResponse({
            cols: [{ name: "id" }],
            rows: [
              [
                { type: "integer", value: "1" },
                { type: "text", value: "extra" },
              ],
            ],
          }),
        ),
      ),
    );

    await expect(query("SELECT 1")).resolves.toMatchObject({
      rows: [{ id: 1, 1: "extra" }],
    });
  });

  it("should throw when the response has no results", async () => {
    server.use(
      http.post(PIPELINE_URL, () => HttpResponse.json({ results: [] })),
    );

    await expect(query("SELECT 1")).rejects.toThrow(
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

      await expect(freshQuery("SELECT 1")).resolves.toMatchObject({ rows: [] });
    },
  );
});

describe("keepWarm", () => {
  afterEach(() => {
    resetGlobal("simon.dev/turso-keep-warm");
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should query Turso every minute", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    const statements: unknown[] = [];
    server.use(
      http.post(PIPELINE_URL, async ({ request }) => {
        statements.push(await request.json());
        return HttpResponse.json(pipelineResponse());
      }),
    );

    keepWarm();
    keepWarm();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(59_999);
    expect(statements).toHaveLength(0);

    vi.advanceTimersByTime(1);
    await vi.waitFor(() => expect(statements).toHaveLength(1));
    expect(statements[0]).toEqual({
      requests: [
        { type: "execute", stmt: { sql: "SELECT 1", args: [] } },
        { type: "close" },
      ],
    });

    vi.advanceTimersByTime(60_000);
    await vi.waitFor(() => expect(statements).toHaveLength(2));
  });

  it("should log a failed query and keep going", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    server.use(
      http.post(PIPELINE_URL, () => new HttpResponse(null, { status: 503 })),
    );

    keepWarm();
    vi.advanceTimersByTime(60_000);

    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        "Turso keep-warm query failed",
      ),
    );
  });
});
