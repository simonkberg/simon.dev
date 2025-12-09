import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getChannelMessages } from "@/lib/discord/api";
import {
  userGetRecentTracks,
  userGetTopAlbums,
  userGetTopArtists,
  userGetTopTracks,
} from "@/lib/lastfm";
import { log } from "@/lib/log";
import { getStats } from "@/lib/wakaTime";
import { server } from "@/mocks/node";

import { createMessage } from "./anthropic";

vi.mock(import("server-only"), () => ({}));
vi.mock(import("@/lib/discord/api"), () => ({ getChannelMessages: vi.fn() }));
vi.mock(import("@/lib/wakaTime"), () => ({ getStats: vi.fn() }));
vi.mock(import("@/lib/lastfm"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    userGetRecentTracks: vi.fn(),
    userGetTopTracks: vi.fn(),
    userGetTopArtists: vi.fn(),
    userGetTopAlbums: vi.fn(),
  };
});

const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1/messages";

async function collectResponses(
  generator: AsyncGenerator<string, void, unknown>,
): Promise<string[]> {
  const results: string[] = [];
  for await (const text of generator) {
    results.push(text);
  }
  return results;
}

describe("createMessage", () => {
  beforeEach(() => {
    vi.spyOn(log, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should create message and yield text content", async () => {
    server.use(
      http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
        const body = await request.json();
        expect(body).toMatchObject({
          model: "claude-haiku-4-5",
          max_tokens: 500,
          system: expect.stringContaining("simon-bot"),
          messages: [{ role: "user", content: "Hello, bot!" }],
        });
        expect(body).toHaveProperty("tools");
        expect(request.headers.get("x-api-key")).toBe("test-anthropic-api-key");
        expect(request.headers.get("anthropic-version")).toBe("2023-06-01");

        return HttpResponse.json({
          content: [{ type: "text", text: "Hello! How can I help you?" }],
          stop_reason: "end_turn",
        });
      }),
    );

    const responses = await collectResponses(createMessage("Hello, bot!"));

    expect(responses).toEqual(["Hello! How can I help you?"]);
  });

  it("should configure fetch with 5 second timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    server.use(
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({
          content: [{ type: "text", text: "Response" }],
          stop_reason: "end_turn",
        }),
      ),
    );

    await collectResponses(createMessage("Test"));

    expect(timeoutSpy).toHaveBeenCalledWith(5000);
    timeoutSpy.mockRestore();
  });

  it.each([
    { status: 400, statusText: "Bad Request" },
    { status: 401, statusText: "Unauthorized" },
    { status: 429, statusText: "Too Many Requests" },
    { status: 500, statusText: "Internal Server Error" },
  ])("should handle HTTP $status error", async ({ status, statusText }) => {
    server.use(
      http.post(
        ANTHROPIC_BASE_URL,
        () => new HttpResponse(null, { status, statusText }),
      ),
    );

    await expect(collectResponses(createMessage("Test"))).rejects.toThrow(
      `Anthropic API error: ${status} ${statusText}`,
    );
  });

  it("should handle invalid response schema", async () => {
    server.use(
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({ invalid: "data" }),
      ),
    );

    await expect(collectResponses(createMessage("Test"))).rejects.toThrow();
  });

  it("should handle response with no content blocks", async () => {
    server.use(
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({ content: [], stop_reason: "end_turn" }),
      ),
    );

    const responses = await collectResponses(createMessage("Test"));
    expect(responses).toEqual([]);
  });

  it("should preserve all content blocks in assistant message history", async () => {
    let callCount = 0;

    server.use(
      http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
        callCount++;
        const body = (await request.json()) as {
          messages: Array<{ role: string; content: unknown }>;
        };

        if (callCount === 1) {
          return HttpResponse.json({
            content: [
              { type: "thinking" },
              { type: "text", text: "let me check..." },
              {
                type: "tool_use",
                id: "tool_123",
                name: "get_wakatime_stats",
                input: {},
              },
            ],
            stop_reason: "tool_use",
          });
        }

        // Verify all blocks are preserved in assistant message
        expect(body.messages[1]?.content).toMatchObject([
          { type: "thinking" },
          { type: "text", text: "let me check..." },
          { type: "tool_use", id: "tool_123", name: "get_wakatime_stats" },
        ]);

        return HttpResponse.json({
          content: [{ type: "text", text: "done!" }],
          stop_reason: "end_turn",
        });
      }),
    );

    const responses = await collectResponses(createMessage("Test"));

    expect(responses).toEqual(["let me check...", "done!"]);
    expect(callCount).toBe(2);
  });

  it("should execute tools and yield results", async () => {
    let callCount = 0;

    server.use(
      http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
        callCount++;
        const body = (await request.json()) as {
          messages: Array<{ role: string; content: unknown }>;
        };

        if (callCount === 1) {
          // First call: Claude requests a tool
          expect(body.messages).toMatchObject([
            { role: "user", content: "what languages has simon been using?" },
          ]);
          return HttpResponse.json({
            content: [
              { type: "text", text: "let me check..." },
              {
                type: "tool_use",
                id: "tool_123",
                name: "get_wakatime_stats",
                input: {},
              },
            ],
            stop_reason: "tool_use",
          });
        }

        // Second call: Claude receives tool result and responds
        expect(body.messages).toMatchObject([
          { role: "user", content: "what languages has simon been using?" },
          {
            role: "assistant",
            content: [
              { type: "text", text: "let me check..." },
              { type: "tool_use", id: "tool_123", name: "get_wakatime_stats" },
            ],
          },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "tool_123" }],
          },
        ]);

        return HttpResponse.json({
          content: [
            {
              type: "text",
              text: "simon has been coding mostly in typescript!",
            },
          ],
          stop_reason: "end_turn",
        });
      }),
    );

    const responses = await collectResponses(
      createMessage("what languages has simon been using?"),
    );

    expect(responses).toEqual([
      "let me check...",
      "simon has been coding mostly in typescript!",
    ]);
    expect(callCount).toBe(2);
  });

  it("should stop after max tool iterations and log warning", async () => {
    const warnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    let callCount = 0;

    server.use(
      http.post(ANTHROPIC_BASE_URL, () => {
        callCount++;
        return HttpResponse.json({
          content: [
            {
              type: "tool_use",
              id: `tool_${callCount}`,
              name: "get_wakatime_stats",
              input: {},
            },
          ],
          stop_reason: "tool_use",
        });
      }),
    );

    const responses = await collectResponses(createMessage("Test"));

    expect(responses).toEqual([]);
    expect(callCount).toBe(5);
    expect(warnSpy).toHaveBeenCalledWith(
      { iterations: 5 },
      "simon-bot reached max tool iterations",
    );
  });

  it("should handle unknown tool gracefully", async () => {
    let callCount = 0;

    server.use(
      http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
        callCount++;

        if (callCount === 1) {
          return HttpResponse.json({
            content: [
              {
                type: "tool_use",
                id: "tool_1",
                name: "unknown_tool",
                input: {},
              },
            ],
            stop_reason: "tool_use",
          });
        }

        const body = (await request.json()) as {
          messages: Array<{
            role: string;
            content: Array<{ type: string; content: string }>;
          }>;
        };
        const toolResult = body.messages[2]?.content[0];
        expect(JSON.parse(toolResult?.content ?? "{}")).toEqual({
          error: "Unknown tool: unknown_tool",
        });

        return HttpResponse.json({
          content: [{ type: "text", text: "handled unknown tool" }],
          stop_reason: "end_turn",
        });
      }),
    );

    const responses = await collectResponses(createMessage("Test"));

    expect(responses).toEqual(["handled unknown tool"]);
    expect(callCount).toBe(2);
  });

  it("should handle tool input validation errors", async () => {
    let callCount = 0;

    server.use(
      http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
        callCount++;

        if (callCount === 1) {
          return HttpResponse.json({
            content: [
              {
                type: "tool_use",
                id: "tool_1",
                name: "get_recent_tracks",
                input: { limit: 999 },
              },
            ],
            stop_reason: "tool_use",
          });
        }

        const body = (await request.json()) as {
          messages: Array<{
            role: string;
            content: Array<{ type: string; content: string }>;
          }>;
        };
        const toolResult = body.messages[2]?.content[0];
        const parsed = JSON.parse(toolResult?.content ?? "{}") as {
          error: string;
        };
        expect(parsed.error).toContain("limit");

        return HttpResponse.json({
          content: [{ type: "text", text: "validation failed" }],
          stop_reason: "end_turn",
        });
      }),
    );

    const responses = await collectResponses(createMessage("Test"));

    expect(responses).toEqual(["validation failed"]);
    expect(callCount).toBe(2);
  });

  it("should execute multiple tools in parallel", async () => {
    vi.mocked(getStats).mockResolvedValue([]);
    vi.mocked(userGetRecentTracks).mockResolvedValue([]);

    let callCount = 0;

    server.use(
      http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
        callCount++;

        if (callCount === 1) {
          return HttpResponse.json({
            content: [
              {
                type: "tool_use",
                id: "tool_1",
                name: "get_wakatime_stats",
                input: {},
              },
              {
                type: "tool_use",
                id: "tool_2",
                name: "get_recent_tracks",
                input: { limit: 5 },
              },
            ],
            stop_reason: "tool_use",
          });
        }

        const body = (await request.json()) as {
          messages: Array<{
            role: string;
            content: Array<{ type: string; tool_use_id: string }>;
          }>;
        };
        const toolResults = body.messages[2]?.content;
        expect(toolResults).toHaveLength(2);
        expect(toolResults?.[0]?.tool_use_id).toBe("tool_1");
        expect(toolResults?.[1]?.tool_use_id).toBe("tool_2");

        return HttpResponse.json({
          content: [{ type: "text", text: "got both results" }],
          stop_reason: "end_turn",
        });
      }),
    );

    const responses = await collectResponses(createMessage("Test"));

    expect(responses).toEqual(["got both results"]);
    expect(getStats).toHaveBeenCalled();
    expect(userGetRecentTracks).toHaveBeenCalledWith("magijo", { limit: 5 });
  });

  it("should yield multiple text blocks from single response", async () => {
    server.use(
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({
          content: [
            { type: "text", text: "First part. " },
            { type: "text", text: "Second part." },
          ],
          stop_reason: "end_turn",
        }),
      ),
    );

    const responses = await collectResponses(createMessage("Test"));

    expect(responses).toEqual(["First part. ", "Second part."]);
  });

  it("should handle tool throwing generic error", async () => {
    vi.mocked(getStats).mockRejectedValue(new Error("Network failure"));

    let callCount = 0;

    server.use(
      http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
        callCount++;

        if (callCount === 1) {
          return HttpResponse.json({
            content: [
              {
                type: "tool_use",
                id: "tool_1",
                name: "get_wakatime_stats",
                input: {},
              },
            ],
            stop_reason: "tool_use",
          });
        }

        const body = (await request.json()) as {
          messages: Array<{
            role: string;
            content: Array<{ type: string; content: string }>;
          }>;
        };
        const toolResult = body.messages[2]?.content[0];
        expect(JSON.parse(toolResult?.content ?? "{}")).toEqual({
          error: "Network failure",
        });

        return HttpResponse.json({
          content: [{ type: "text", text: "handled error" }],
          stop_reason: "end_turn",
        });
      }),
    );

    const responses = await collectResponses(createMessage("Test"));

    expect(responses).toEqual(["handled error"]);
  });

  describe("tool execution", () => {
    it("should call getChannelMessages for get_chat_history tool", async () => {
      vi.mocked(getChannelMessages).mockResolvedValue([]);

      let callCount = 0;

      server.use(
        http.post(ANTHROPIC_BASE_URL, () => {
          callCount++;

          if (callCount === 1) {
            return HttpResponse.json({
              content: [
                {
                  type: "tool_use",
                  id: "tool_1",
                  name: "get_chat_history",
                  input: { limit: 5 },
                },
              ],
              stop_reason: "tool_use",
            });
          }

          return HttpResponse.json({
            content: [{ type: "text", text: "done" }],
            stop_reason: "end_turn",
          });
        }),
      );

      await collectResponses(createMessage("Test"));

      expect(getChannelMessages).toHaveBeenCalledWith(5);
    });

    it("should call userGetTopTracks for get_top_tracks tool", async () => {
      vi.mocked(userGetTopTracks).mockResolvedValue([]);

      let callCount = 0;

      server.use(
        http.post(ANTHROPIC_BASE_URL, () => {
          callCount++;

          if (callCount === 1) {
            return HttpResponse.json({
              content: [
                {
                  type: "tool_use",
                  id: "tool_1",
                  name: "get_top_tracks",
                  input: { period: "3month", limit: 10 },
                },
              ],
              stop_reason: "tool_use",
            });
          }

          return HttpResponse.json({
            content: [{ type: "text", text: "done" }],
            stop_reason: "end_turn",
          });
        }),
      );

      await collectResponses(createMessage("Test"));

      expect(userGetTopTracks).toHaveBeenCalledWith("magijo", {
        period: "3month",
        limit: 10,
      });
    });

    it("should call userGetTopArtists for get_top_artists tool", async () => {
      vi.mocked(userGetTopArtists).mockResolvedValue([]);

      let callCount = 0;

      server.use(
        http.post(ANTHROPIC_BASE_URL, () => {
          callCount++;

          if (callCount === 1) {
            return HttpResponse.json({
              content: [
                {
                  type: "tool_use",
                  id: "tool_1",
                  name: "get_top_artists",
                  input: { period: "6month", limit: 3 },
                },
              ],
              stop_reason: "tool_use",
            });
          }

          return HttpResponse.json({
            content: [{ type: "text", text: "done" }],
            stop_reason: "end_turn",
          });
        }),
      );

      await collectResponses(createMessage("Test"));

      expect(userGetTopArtists).toHaveBeenCalledWith("magijo", {
        period: "6month",
        limit: 3,
      });
    });

    it("should call userGetTopAlbums for get_top_albums tool", async () => {
      vi.mocked(userGetTopAlbums).mockResolvedValue([]);

      let callCount = 0;

      server.use(
        http.post(ANTHROPIC_BASE_URL, () => {
          callCount++;

          if (callCount === 1) {
            return HttpResponse.json({
              content: [
                {
                  type: "tool_use",
                  id: "tool_1",
                  name: "get_top_albums",
                  input: { period: "12month", limit: 7 },
                },
              ],
              stop_reason: "tool_use",
            });
          }

          return HttpResponse.json({
            content: [{ type: "text", text: "done" }],
            stop_reason: "end_turn",
          });
        }),
      );

      await collectResponses(createMessage("Test"));

      expect(userGetTopAlbums).toHaveBeenCalledWith("magijo", {
        period: "12month",
        limit: 7,
      });
    });

    it("should use default values when tool input is empty", async () => {
      vi.mocked(userGetTopTracks).mockResolvedValue([]);

      let callCount = 0;

      server.use(
        http.post(ANTHROPIC_BASE_URL, () => {
          callCount++;

          if (callCount === 1) {
            return HttpResponse.json({
              content: [
                {
                  type: "tool_use",
                  id: "tool_1",
                  name: "get_top_tracks",
                  input: {},
                },
              ],
              stop_reason: "tool_use",
            });
          }

          return HttpResponse.json({
            content: [{ type: "text", text: "done" }],
            stop_reason: "end_turn",
          });
        }),
      );

      await collectResponses(createMessage("Test"));

      expect(userGetTopTracks).toHaveBeenCalledWith("magijo", {
        period: "1month",
        limit: 5,
      });
    });
  });
});
