import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { config } from "@/config";
import { getChannelMessages, searchChannelMessages } from "@/lib/discord/api";
import {
  userGetRecentTracks,
  userGetTopAlbums,
  userGetTopArtists,
  userGetTopTracks,
} from "@/lib/lastfm";
import { log } from "@/lib/log";
import {
  buildMemoryContext,
  edit,
  forget,
  recall,
  remember,
} from "@/lib/memory";
import { getStats } from "@/lib/wakaTime";
import { server } from "@/mocks/node";

import { createMessage } from "./anthropic";

vi.mock(import("server-only"), () => ({}));
vi.mock(import("@/lib/discord/api"), () => ({
  getChannelMessages: vi.fn(),
  searchChannelMessages: vi.fn(),
}));
vi.mock(import("@/lib/memory"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    buildMemoryContext: vi.fn(),
    remember: vi.fn(),
    edit: vi.fn(),
    recall: vi.fn(),
    forget: vi.fn(),
  };
});
vi.mock(import("@/lib/wakaTime"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getStats: vi.fn() };
});
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
const TEST_USERNAME = "test-user";
const MEMORY_CONTEXT = "<memory>\n## self\n(nothing yet)\n</memory>";

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
    vi.spyOn(log, "info").mockImplementation(() => {});
    vi.mocked(buildMemoryContext).mockResolvedValue(MEMORY_CONTEXT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should create message and yield text content", async () => {
    server.use(
      http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
        expect(await request.json()).toMatchObject({
          model: "claude-sonnet-5",
          thinking: { type: "adaptive" },
          output_config: { effort: "medium" },
          max_tokens: 2048,
          system: [
            {
              type: "text",
              text: expect.stringContaining("simon-bot"),
              cache_control: { type: "ephemeral" },
            },
            { type: "text", text: MEMORY_CONTEXT },
          ],
          messages: [
            { role: "user", content: `${TEST_USERNAME}: Hello, bot!` },
          ],
          tools: [
            { name: "get_chat_history" },
            { name: "get_wakatime_stats" },
            { name: "get_recent_tracks" },
            { name: "get_top_tracks" },
            { name: "get_top_artists" },
            { name: "get_top_albums" },
            { name: "search_messages" },
            { name: "remember" },
            { name: "recall" },
            { name: "edit" },
            { name: "forget" },
          ],
        });
        expect(request.headers.get("x-api-key")).toBe("test-anthropic-api-key");
        expect(request.headers.get("anthropic-version")).toBe("2023-06-01");

        return HttpResponse.json({
          content: [{ type: "text", text: "Hello! How can I help you?" }],
          stop_reason: "end_turn",
        });
      }),
    );

    const responses = await collectResponses(
      createMessage([
        { role: "user", username: TEST_USERNAME, content: "Hello, bot!" },
      ]),
    );

    expect(responses).toEqual(["Hello! How can I help you?"]);
    expect(buildMemoryContext).toHaveBeenCalledWith([TEST_USERNAME]);
  });

  it("should build memory context from the user participants only", async () => {
    server.use(
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
        }),
      ),
    );

    await collectResponses(
      createMessage([
        { role: "user", username: "Alice", content: "Hello" },
        { role: "assistant", username: "simon-bot", content: "Hi there!" },
        { role: "user", username: "Bob", content: "How are you?" },
      ]),
    );

    expect(buildMemoryContext).toHaveBeenCalledWith(["Alice", "Bob"]);
  });

  it("should omit the memory block when there is no memory context", async () => {
    vi.mocked(buildMemoryContext).mockResolvedValue("");

    server.use(
      http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
        const body = (await request.json()) as { system: unknown[] };
        expect(body.system).toHaveLength(1);
        return HttpResponse.json({
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
        });
      }),
    );

    const responses = await collectResponses(
      createMessage([
        { role: "user", username: TEST_USERNAME, content: "Hello, bot!" },
      ]),
    );

    expect(responses).toEqual(["ok"]);
  });

  describe("memory tools", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    async function runTool(
      name: string,
      input: Record<string, unknown>,
    ): Promise<string> {
      let toolResult = "";
      let callCount = 0;

      server.use(
        http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
          callCount++;
          if (callCount === 1) {
            return HttpResponse.json({
              content: [{ type: "tool_use", id: "tool_1", name, input }],
              stop_reason: "tool_use",
            });
          }

          const body = (await request.json()) as {
            messages: Array<{ content: Array<{ content: string }> }>;
          };
          toolResult = body.messages[2]?.content[0]?.content ?? "";
          return HttpResponse.json({
            content: [{ type: "text", text: "done" }],
            stop_reason: "end_turn",
          });
        }),
      );

      await collectResponses(
        createMessage([
          { role: "user", username: TEST_USERNAME, content: "hi" },
        ]),
      );
      return toolResult;
    }

    const CHANGED = {
      id: 3,
      category: "self",
      content: "i like dogs",
      createdAt: "2025-01-01T00:00:00.000Z",
    };

    it("should save notes with remember", async () => {
      const memory = {
        id: 1,
        category: "self",
        content: "i like trains",
        createdAt: "2025-01-01T00:00:00.000Z",
      };
      vi.mocked(remember).mockResolvedValue({ status: "ok", memory });

      const result = await runTool("remember", {
        category: "self",
        content: "i like trains",
      });

      expect(remember).toHaveBeenCalledWith({
        category: "self",
        content: "i like trains",
      });
      expect(JSON.parse(result)).toEqual(memory);
    });

    it("should say when a category is full instead of saving", async () => {
      vi.mocked(remember).mockResolvedValue({
        status: "full",
        category: "self",
      });

      const result = await runTool("remember", {
        category: "self",
        content: "one more",
      });

      expect(JSON.parse(result)).toEqual({
        error: 'Category "self" is full (25 memories). Forget something first.',
      });
    });

    it("should read notes with recall and apply defaults", async () => {
      vi.mocked(recall).mockResolvedValue([]);

      const result = await runTool("recall", { category: "jokes" });

      expect(recall).toHaveBeenCalledWith({ category: "jokes", limit: 20 });
      expect(JSON.parse(result)).toEqual([]);
    });

    it("should rewrite notes with edit", async () => {
      const memory = {
        id: 3,
        category: "self",
        content: "i like trains",
        createdAt: "2025-01-01T00:00:00.000Z",
      };
      vi.mocked(edit).mockResolvedValue({ status: "ok", memory });

      const result = await runTool("edit", {
        id: 3,
        old_content: "i like cats",
        new_content: "i like trains",
      });

      expect(edit).toHaveBeenCalledWith({
        id: 3,
        oldContent: "i like cats",
        newContent: "i like trains",
        category: undefined,
      });
      expect(JSON.parse(result)).toEqual(memory);
    });

    it("should pass a category through to move a note", async () => {
      vi.mocked(edit).mockResolvedValue({
        status: "ok",
        memory: {
          id: 3,
          category: "context",
          content: "this chat gets spam",
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      });

      await runTool("edit", {
        id: 3,
        old_content: "this chat gets spam",
        new_content: "this chat gets spam",
        category: "context",
      });

      expect(edit).toHaveBeenCalledWith({
        id: 3,
        oldContent: "this chat gets spam",
        newContent: "this chat gets spam",
        category: "context",
      });
    });

    it("should hand a changed note back instead of editing it", async () => {
      vi.mocked(edit).mockResolvedValue({ status: "stale", current: CHANGED });

      const result = await runTool("edit", {
        id: 3,
        old_content: "i like cats",
        new_content: "i like trains",
      });

      expect(JSON.parse(result)).toEqual({
        error:
          "Note #3 has changed since you read it - work from its current text",
        current: CHANGED,
      });
    });

    it("should say when a move would overfill a category", async () => {
      vi.mocked(edit).mockResolvedValue({
        status: "full",
        category: "context",
      });

      const result = await runTool("edit", {
        id: 3,
        old_content: "this chat gets spam",
        new_content: "this chat gets spam",
        category: "context",
      });

      expect(JSON.parse(result)).toEqual({
        error:
          'Category "context" is full (25 memories). Forget something first.',
      });
    });

    it("should delete notes with forget", async () => {
      vi.mocked(forget).mockResolvedValue({ status: "ok" });

      const result = await runTool("forget", { id: 3, content: "i like cats" });

      expect(forget).toHaveBeenCalledWith({ id: 3, content: "i like cats" });
      expect(JSON.parse(result)).toEqual({ forgotten: true });
    });

    it("should hand a changed note back instead of forgetting it", async () => {
      vi.mocked(forget).mockResolvedValue({
        status: "stale",
        current: CHANGED,
      });

      const result = await runTool("forget", { id: 3, content: "i like cats" });

      expect(JSON.parse(result)).toEqual({
        error:
          "Note #3 has changed since you read it - work from its current text",
        current: CHANGED,
      });
    });

    it("should say when a note to forget is already gone", async () => {
      vi.mocked(forget).mockResolvedValue({ status: "missing", id: 3 });

      const result = await runTool("forget", { id: 3, content: "i like cats" });

      expect(JSON.parse(result)).toEqual({
        error: "There is no note #3 - it may have been forgotten already",
      });
    });

    it("should return validation errors instead of saving", async () => {
      const result = await runTool("remember", {
        category: "Not Valid!",
        content: "x",
      });

      expect(remember).not.toHaveBeenCalled();
      expect(JSON.parse(result)).toEqual({
        error: expect.stringContaining("category"),
      });
    });
  });

  it("should accept array of chat messages", async () => {
    server.use(
      http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
        const body = (await request.json()) as {
          messages: Array<{ role: string; content: string }>;
        };
        expect(body).toMatchObject({
          messages: [
            { role: "user", content: "Alice: Hello" },
            { role: "assistant", content: "Hi there!" },
            { role: "user", content: "Bob: How are you?" },
          ],
        });
        return HttpResponse.json({
          content: [{ type: "text", text: "I'm good!" }],
          stop_reason: "end_turn",
        });
      }),
    );

    const responses = await collectResponses(
      createMessage([
        { role: "user", username: "Alice", content: "Hello" },
        { role: "assistant", username: "simon-bot", content: "Hi there!" },
        { role: "user", username: "Bob", content: "How are you?" },
      ]),
    );

    expect(responses).toEqual(["I'm good!"]);
  });

  it("should not add prefix to assistant messages", async () => {
    server.use(
      http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
        const body = (await request.json()) as {
          messages: Array<{ role: string; content: string }>;
        };
        // Assistant message should NOT have "simon-bot: " prefix
        expect(body.messages[1]).toEqual({
          role: "assistant",
          content: "Previous bot response",
        });
        return HttpResponse.json({
          content: [{ type: "text", text: "Response" }],
          stop_reason: "end_turn",
        });
      }),
    );

    await collectResponses(
      createMessage([
        { role: "user", username: "User", content: "First" },
        {
          role: "assistant",
          username: "simon-bot",
          content: "Previous bot response",
        },
        { role: "user", username: "User", content: "Second" },
      ]),
    );
  });

  it("should configure fetch with 15 second timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    server.use(
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({
          content: [{ type: "text", text: "Response" }],
          stop_reason: "end_turn",
        }),
      ),
    );

    await collectResponses(
      createMessage([
        { role: "user", username: TEST_USERNAME, content: "Test" },
      ]),
    );

    expect(timeoutSpy).toHaveBeenCalledWith(15_000);
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

    await expect(
      collectResponses(
        createMessage([
          { role: "user", username: TEST_USERNAME, content: "Test" },
        ]),
      ),
    ).rejects.toThrow(`Anthropic API error: ${status} ${statusText}`);
  });

  it("should handle invalid response schema", async () => {
    server.use(
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({ invalid: "data" }),
      ),
    );

    await expect(
      collectResponses(
        createMessage([
          { role: "user", username: TEST_USERNAME, content: "Test" },
        ]),
      ),
    ).rejects.toThrow();
  });

  it("should handle response with no content blocks", async () => {
    server.use(
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({ content: [], stop_reason: "end_turn" }),
      ),
    );

    const responses = await collectResponses(
      createMessage([
        { role: "user", username: TEST_USERNAME, content: "Test" },
      ]),
    );
    expect(responses).toEqual([]);
  });

  it("should handle a refused response", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});

    server.use(
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({ content: [], stop_reason: "refusal" }),
      ),
    );

    const responses = await collectResponses(
      createMessage([
        { role: "user", username: TEST_USERNAME, content: "Test" },
      ]),
    );

    expect(responses).toEqual(["yeah I'm not touching that one, sorry"]);
    expect(warn).toHaveBeenCalledWith(
      { loop: "reply" },
      "simon-bot response was refused",
    );
  });

  it("should yield only the fallback when a refusal carries text", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => {});

    server.use(
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({
          content: [{ type: "text", text: "here's how you do it" }],
          stop_reason: "refusal",
        }),
      ),
    );

    const responses = await collectResponses(
      createMessage([
        { role: "user", username: TEST_USERNAME, content: "Test" },
      ]),
    );

    expect(responses).toEqual(["yeah I'm not touching that one, sorry"]);
  });

  it("should warn when the response hits the token limit", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});

    server.use(
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({
          content: [{ type: "text", text: "so anyway I was thinking abo" }],
          stop_reason: "max_tokens",
        }),
      ),
    );

    const responses = await collectResponses(
      createMessage([
        { role: "user", username: TEST_USERNAME, content: "Test" },
      ]),
    );

    expect(responses).toEqual([
      "so anyway I was thinking abo",
      "...welp, ran out of words there",
    ]);
    expect(warn).toHaveBeenCalledWith(
      { loop: "reply" },
      "simon-bot response hit the token limit",
    );
  });

  it("should still say something when the limit leaves no text", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => {});

    server.use(
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({
          content: [{ type: "thinking", thinking: "...", signature: "sig" }],
          stop_reason: "max_tokens",
        }),
      ),
    );

    const responses = await collectResponses(
      createMessage([
        { role: "user", username: TEST_USERNAME, content: "Test" },
      ]),
    );

    expect(responses).toEqual(["...welp, ran out of words there"]);
  });

  it("should preserve all content blocks in assistant message history", async () => {
    let callCount = 0;

    server.use(
      http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
        callCount++;

        const thinkingBlock = {
          type: "thinking",
          thinking: "hmm, they want stats",
          signature: "sig_abc123",
        };
        const textBlock = { type: "text", text: "let me check..." };
        const toolUse = {
          type: "tool_use",
          id: "tool_123",
          name: "get_wakatime_stats",
          input: {},
        };

        if (callCount === 1) {
          return HttpResponse.json({
            content: [thinkingBlock, textBlock, toolUse],
            stop_reason: "tool_use",
          });
        }

        expect(await request.json()).toMatchObject({
          messages: [
            { role: "user", content: `${TEST_USERNAME}: Test` },
            { role: "assistant", content: [thinkingBlock, textBlock, toolUse] },
            {
              role: "user",
              content: [{ type: "tool_result", tool_use_id: toolUse.id }],
            },
          ],
        });

        return HttpResponse.json({
          content: [{ type: "text", text: "done!" }],
          stop_reason: "end_turn",
        });
      }),
    );

    const responses = await collectResponses(
      createMessage([
        { role: "user", username: TEST_USERNAME, content: "Test" },
      ]),
    );

    expect(responses).toEqual(["let me check...", "done!"]);
    expect(callCount).toBe(2);
  });

  it("should execute tools and yield results", async () => {
    let callCount = 0;

    server.use(
      http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
        callCount++;

        const textBlock = { type: "text", text: "let me check..." };
        const toolUse = {
          type: "tool_use",
          id: "tool_123",
          name: "get_wakatime_stats",
          input: {},
        };

        if (callCount === 1) {
          expect(await request.json()).toMatchObject({
            messages: [
              {
                role: "user",
                content: `${TEST_USERNAME}: what languages has simon been using?`,
              },
            ],
          });
          return HttpResponse.json({
            content: [textBlock, toolUse],
            stop_reason: "tool_use",
          });
        }

        expect(await request.json()).toMatchObject({
          messages: [
            {
              role: "user",
              content: `${TEST_USERNAME}: what languages has simon been using?`,
            },
            { role: "assistant", content: [textBlock, toolUse] },
            {
              role: "user",
              content: [{ type: "tool_result", tool_use_id: toolUse.id }],
            },
          ],
        });

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
      createMessage([
        {
          role: "user",
          username: TEST_USERNAME,
          content: "what languages has simon been using?",
        },
      ]),
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

    const responses = await collectResponses(
      createMessage([
        { role: "user", username: TEST_USERNAME, content: "Test" },
      ]),
    );

    expect(responses).toEqual([
      "sorry, I got stuck in a loop and couldn't finish my thought...",
    ]);
    expect(callCount).toBe(5);
    expect(warnSpy).toHaveBeenCalledWith(
      { loop: "reply", iterations: 5 },
      "simon-bot reached max tool iterations",
    );
  });

  it("should handle unknown tool gracefully", async () => {
    let callCount = 0;

    server.use(
      http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
        callCount++;

        const toolUse = {
          type: "tool_use",
          id: "tool_1",
          name: "unknown_tool",
          input: {},
        };

        if (callCount === 1) {
          return HttpResponse.json({
            content: [toolUse],
            stop_reason: "tool_use",
          });
        }

        expect(await request.json()).toMatchObject({
          messages: [
            { role: "user", content: `${TEST_USERNAME}: Test` },
            { role: "assistant", content: [toolUse] },
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: JSON.stringify({
                    error: "Unknown tool: unknown_tool",
                  }),
                },
              ],
            },
          ],
        });

        return HttpResponse.json({
          content: [{ type: "text", text: "handled unknown tool" }],
          stop_reason: "end_turn",
        });
      }),
    );

    const responses = await collectResponses(
      createMessage([
        { role: "user", username: TEST_USERNAME, content: "Test" },
      ]),
    );

    expect(responses).toEqual(["handled unknown tool"]);
    expect(callCount).toBe(2);
  });

  it("should handle tool input validation errors", async () => {
    let callCount = 0;

    server.use(
      http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
        callCount++;

        const toolUse = {
          type: "tool_use",
          id: "tool_1",
          name: "get_recent_tracks",
          input: { limit: 999 },
        };

        if (callCount === 1) {
          return HttpResponse.json({
            content: [toolUse],
            stop_reason: "tool_use",
          });
        }

        expect(await request.json()).toMatchObject({
          messages: [
            { role: "user", content: `${TEST_USERNAME}: Test` },
            { role: "assistant", content: [toolUse] },
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: expect.stringContaining("limit"),
                },
              ],
            },
          ],
        });

        return HttpResponse.json({
          content: [{ type: "text", text: "validation failed" }],
          stop_reason: "end_turn",
        });
      }),
    );

    const responses = await collectResponses(
      createMessage([
        { role: "user", username: TEST_USERNAME, content: "Test" },
      ]),
    );

    expect(responses).toEqual(["validation failed"]);
    expect(callCount).toBe(2);
  });

  it("should execute multiple tools in parallel", async () => {
    const mockStats = [{ name: "TypeScript", percent: 80 }];
    const mockTracks = [
      {
        name: "Track 1",
        artist: "Artist 1",
        album: "Album 1",
        playedAt: undefined,
        nowPlaying: false,
        loved: false,
      },
    ];
    vi.mocked(getStats).mockResolvedValue(mockStats);
    vi.mocked(userGetRecentTracks).mockResolvedValue(mockTracks);

    let callCount = 0;

    server.use(
      http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
        callCount++;

        const wakatimeToolUse = {
          type: "tool_use",
          id: "tool_1",
          name: "get_wakatime_stats",
          input: {},
        };
        const recentTracksToolUse = {
          type: "tool_use",
          id: "tool_2",
          name: "get_recent_tracks",
          input: { limit: 5 },
        };

        if (callCount === 1) {
          return HttpResponse.json({
            content: [wakatimeToolUse, recentTracksToolUse],
            stop_reason: "tool_use",
          });
        }

        expect(await request.json()).toMatchObject({
          messages: [
            { role: "user", content: `${TEST_USERNAME}: Test` },
            {
              role: "assistant",
              content: [wakatimeToolUse, recentTracksToolUse],
            },
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: wakatimeToolUse.id,
                  content: JSON.stringify(mockStats),
                },
                {
                  type: "tool_result",
                  tool_use_id: recentTracksToolUse.id,
                  content: JSON.stringify(mockTracks),
                },
              ],
            },
          ],
        });

        return HttpResponse.json({
          content: [{ type: "text", text: "got both results" }],
          stop_reason: "end_turn",
        });
      }),
    );

    const responses = await collectResponses(
      createMessage([
        { role: "user", username: TEST_USERNAME, content: "Test" },
      ]),
    );

    expect(responses).toEqual(["got both results"]);
    expect(getStats).toHaveBeenCalled();
    expect(userGetRecentTracks).toHaveBeenCalledWith(config.lastfmUsername, {
      limit: 5,
    });
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

    const responses = await collectResponses(
      createMessage([
        { role: "user", username: TEST_USERNAME, content: "Test" },
      ]),
    );

    expect(responses).toEqual(["First part. ", "Second part."]);
  });

  it("should handle tool throwing generic error", async () => {
    vi.mocked(getStats).mockRejectedValue(new Error("Network failure"));

    let callCount = 0;

    server.use(
      http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
        callCount++;

        const toolUse = {
          type: "tool_use",
          id: "tool_1",
          name: "get_wakatime_stats",
          input: {},
        };

        if (callCount === 1) {
          return HttpResponse.json({
            content: [toolUse],
            stop_reason: "tool_use",
          });
        }

        expect(await request.json()).toMatchObject({
          messages: [
            { role: "user", content: `${TEST_USERNAME}: Test` },
            { role: "assistant", content: [toolUse] },
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: JSON.stringify({ error: "Network failure" }),
                },
              ],
            },
          ],
        });

        return HttpResponse.json({
          content: [{ type: "text", text: "handled error" }],
          stop_reason: "end_turn",
        });
      }),
    );

    const responses = await collectResponses(
      createMessage([
        { role: "user", username: TEST_USERNAME, content: "Test" },
      ]),
    );

    expect(responses).toEqual(["handled error"]);
  });

  it("should handle tool throwing non-Error value", async () => {
    vi.mocked(getStats).mockRejectedValue("string error");

    let callCount = 0;

    server.use(
      http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
        callCount++;

        const toolUse = {
          type: "tool_use",
          id: "tool_1",
          name: "get_wakatime_stats",
          input: {},
        };

        if (callCount === 1) {
          return HttpResponse.json({
            content: [toolUse],
            stop_reason: "tool_use",
          });
        }

        expect(await request.json()).toMatchObject({
          messages: [
            { role: "user", content: `${TEST_USERNAME}: Test` },
            { role: "assistant", content: [toolUse] },
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: JSON.stringify({ error: "Unknown error" }),
                },
              ],
            },
          ],
        });

        return HttpResponse.json({
          content: [{ type: "text", text: "handled unknown error" }],
          stop_reason: "end_turn",
        });
      }),
    );

    const responses = await collectResponses(
      createMessage([
        { role: "user", username: TEST_USERNAME, content: "Test" },
      ]),
    );

    expect(responses).toEqual(["handled unknown error"]);
  });

  describe("tool execution", () => {
    it("should call getChannelMessages for get_chat_history tool", async () => {
      const mockMessages = [
        {
          id: "1",
          user: { name: "User1", color: "hsl(0 50% 50%)" as const },
          content: "Hello",
          edited: false,
          timestamp: new Date("2025-01-01T00:00:00.000000+00:00"),
          replies: [],
        },
        {
          id: "2",
          user: { name: "User2", color: "hsl(120 50% 50%)" as const },
          content: "World",
          edited: false,
          timestamp: new Date("2025-01-01T00:01:00.000000+00:00"),
          replies: [],
        },
      ];
      vi.mocked(getChannelMessages).mockResolvedValue(mockMessages);

      let callCount = 0;

      server.use(
        http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
          callCount++;

          const toolUse = {
            type: "tool_use",
            id: "tool_1",
            name: "get_chat_history",
            input: { limit: 5 },
          };

          if (callCount === 1) {
            return HttpResponse.json({
              content: [toolUse],
              stop_reason: "tool_use",
            });
          }

          expect(await request.json()).toMatchObject({
            messages: [
              { role: "user", content: `${TEST_USERNAME}: Test` },
              { role: "assistant", content: [toolUse] },
              {
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    content: JSON.stringify(mockMessages),
                  },
                ],
              },
            ],
          });

          return HttpResponse.json({
            content: [{ type: "text", text: "done" }],
            stop_reason: "end_turn",
          });
        }),
      );

      await collectResponses(
        createMessage([
          { role: "user", username: TEST_USERNAME, content: "Test" },
        ]),
      );

      expect(getChannelMessages).toHaveBeenCalledWith(5);
    });

    it("should call userGetTopTracks for get_top_tracks tool", async () => {
      const mockTracks = [
        { name: "Track 1", artist: "Artist 1", playcount: 100, rank: 1 },
        { name: "Track 2", artist: "Artist 2", playcount: 50, rank: 2 },
      ];
      vi.mocked(userGetTopTracks).mockResolvedValue(mockTracks);

      let callCount = 0;

      server.use(
        http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
          callCount++;

          const toolUse = {
            type: "tool_use",
            id: "tool_1",
            name: "get_top_tracks",
            input: { period: "3month", limit: 10 },
          };

          if (callCount === 1) {
            return HttpResponse.json({
              content: [toolUse],
              stop_reason: "tool_use",
            });
          }

          expect(await request.json()).toMatchObject({
            messages: [
              { role: "user", content: `${TEST_USERNAME}: Test` },
              { role: "assistant", content: [toolUse] },
              {
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    content: JSON.stringify(mockTracks),
                  },
                ],
              },
            ],
          });

          return HttpResponse.json({
            content: [{ type: "text", text: "done" }],
            stop_reason: "end_turn",
          });
        }),
      );

      await collectResponses(
        createMessage([
          { role: "user", username: TEST_USERNAME, content: "Test" },
        ]),
      );

      expect(userGetTopTracks).toHaveBeenCalledWith(config.lastfmUsername, {
        period: "3month",
        limit: 10,
      });
    });

    it("should call userGetTopArtists for get_top_artists tool", async () => {
      const mockArtists = [
        { name: "Artist 1", playcount: 200, rank: 1 },
        { name: "Artist 2", playcount: 150, rank: 2 },
      ];
      vi.mocked(userGetTopArtists).mockResolvedValue(mockArtists);

      let callCount = 0;

      server.use(
        http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
          callCount++;

          const toolUse = {
            type: "tool_use",
            id: "tool_1",
            name: "get_top_artists",
            input: { period: "6month", limit: 3 },
          };

          if (callCount === 1) {
            return HttpResponse.json({
              content: [toolUse],
              stop_reason: "tool_use",
            });
          }

          expect(await request.json()).toMatchObject({
            messages: [
              { role: "user", content: `${TEST_USERNAME}: Test` },
              { role: "assistant", content: [toolUse] },
              {
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    content: JSON.stringify(mockArtists),
                  },
                ],
              },
            ],
          });

          return HttpResponse.json({
            content: [{ type: "text", text: "done" }],
            stop_reason: "end_turn",
          });
        }),
      );

      await collectResponses(
        createMessage([
          { role: "user", username: TEST_USERNAME, content: "Test" },
        ]),
      );

      expect(userGetTopArtists).toHaveBeenCalledWith(config.lastfmUsername, {
        period: "6month",
        limit: 3,
      });
    });

    it("should call userGetTopAlbums for get_top_albums tool", async () => {
      const mockAlbums = [
        { name: "Album 1", artist: "Artist 1", playcount: 80, rank: 1 },
        { name: "Album 2", artist: "Artist 2", playcount: 60, rank: 2 },
      ];
      vi.mocked(userGetTopAlbums).mockResolvedValue(mockAlbums);

      let callCount = 0;

      server.use(
        http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
          callCount++;

          const toolUse = {
            type: "tool_use",
            id: "tool_1",
            name: "get_top_albums",
            input: { period: "12month", limit: 7 },
          };

          if (callCount === 1) {
            return HttpResponse.json({
              content: [toolUse],
              stop_reason: "tool_use",
            });
          }

          expect(await request.json()).toMatchObject({
            messages: [
              { role: "user", content: `${TEST_USERNAME}: Test` },
              { role: "assistant", content: [toolUse] },
              {
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    content: JSON.stringify(mockAlbums),
                  },
                ],
              },
            ],
          });

          return HttpResponse.json({
            content: [{ type: "text", text: "done" }],
            stop_reason: "end_turn",
          });
        }),
      );

      await collectResponses(
        createMessage([
          { role: "user", username: TEST_USERNAME, content: "Test" },
        ]),
      );

      expect(userGetTopAlbums).toHaveBeenCalledWith(config.lastfmUsername, {
        period: "12month",
        limit: 7,
      });
    });

    it("should call getStats for get_wakatime_stats tool", async () => {
      const mockStats = [
        { name: "TypeScript", percent: 80 },
        { name: "JavaScript", percent: 15 },
      ];
      vi.mocked(getStats).mockResolvedValue(mockStats);

      let callCount = 0;

      server.use(
        http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
          callCount++;

          const toolUse = {
            type: "tool_use",
            id: "tool_1",
            name: "get_wakatime_stats",
            input: { period: "last_30_days", limit: 10 },
          };

          if (callCount === 1) {
            return HttpResponse.json({
              content: [toolUse],
              stop_reason: "tool_use",
            });
          }

          expect(await request.json()).toMatchObject({
            messages: [
              { role: "user", content: `${TEST_USERNAME}: Test` },
              { role: "assistant", content: [toolUse] },
              {
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    content: JSON.stringify(mockStats),
                  },
                ],
              },
            ],
          });

          return HttpResponse.json({
            content: [{ type: "text", text: "done" }],
            stop_reason: "end_turn",
          });
        }),
      );

      await collectResponses(
        createMessage([
          { role: "user", username: TEST_USERNAME, content: "Test" },
        ]),
      );

      expect(getStats).toHaveBeenCalledWith("last_30_days", 10);
    });

    it("should call userGetRecentTracks for get_recent_tracks tool", async () => {
      const mockTracks = [
        {
          name: "Track 1",
          artist: "Artist 1",
          album: "Album 1",
          playedAt: new Date("2025-01-01"),
          nowPlaying: false,
          loved: true,
        },
      ];
      vi.mocked(userGetRecentTracks).mockResolvedValue(mockTracks);

      let callCount = 0;

      server.use(
        http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
          callCount++;

          const toolUse = {
            type: "tool_use",
            id: "tool_1",
            name: "get_recent_tracks",
            input: { limit: 10 },
          };

          if (callCount === 1) {
            return HttpResponse.json({
              content: [toolUse],
              stop_reason: "tool_use",
            });
          }

          expect(await request.json()).toMatchObject({
            messages: [
              { role: "user", content: `${TEST_USERNAME}: Test` },
              { role: "assistant", content: [toolUse] },
              {
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    content: JSON.stringify(mockTracks),
                  },
                ],
              },
            ],
          });

          return HttpResponse.json({
            content: [{ type: "text", text: "done" }],
            stop_reason: "end_turn",
          });
        }),
      );

      await collectResponses(
        createMessage([
          { role: "user", username: TEST_USERNAME, content: "Test" },
        ]),
      );

      expect(userGetRecentTracks).toHaveBeenCalledWith(config.lastfmUsername, {
        limit: 10,
      });
    });

    it("should use default values when tool inputs are empty", async () => {
      vi.mocked(getChannelMessages).mockResolvedValue([]);
      vi.mocked(getStats).mockResolvedValue([]);
      vi.mocked(userGetRecentTracks).mockResolvedValue([]);
      vi.mocked(userGetTopTracks).mockResolvedValue([]);
      vi.mocked(userGetTopArtists).mockResolvedValue([]);
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
                  name: "get_chat_history",
                  input: {},
                },
                {
                  type: "tool_use",
                  id: "tool_2",
                  name: "get_wakatime_stats",
                  input: {},
                },
                {
                  type: "tool_use",
                  id: "tool_3",
                  name: "get_recent_tracks",
                  input: {},
                },
                {
                  type: "tool_use",
                  id: "tool_4",
                  name: "get_top_tracks",
                  input: {},
                },
                {
                  type: "tool_use",
                  id: "tool_5",
                  name: "get_top_artists",
                  input: {},
                },
                {
                  type: "tool_use",
                  id: "tool_6",
                  name: "get_top_albums",
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

      await collectResponses(
        createMessage([
          { role: "user", username: TEST_USERNAME, content: "Test" },
        ]),
      );

      expect(getChannelMessages).toHaveBeenCalledWith(50);
      expect(getStats).toHaveBeenCalledWith("last_30_days", 10);
      expect(userGetRecentTracks).toHaveBeenCalledWith(config.lastfmUsername, {
        limit: 5,
      });
      expect(userGetTopTracks).toHaveBeenCalledWith(config.lastfmUsername, {
        period: "1month",
        limit: 10,
      });
      expect(userGetTopArtists).toHaveBeenCalledWith(config.lastfmUsername, {
        period: "1month",
        limit: 10,
      });
      expect(userGetTopAlbums).toHaveBeenCalledWith(config.lastfmUsername, {
        period: "1month",
        limit: 10,
      });
    });

    it("should pass custom username to Last.fm tools", async () => {
      vi.mocked(userGetRecentTracks).mockResolvedValue([]);
      vi.mocked(userGetTopTracks).mockResolvedValue([]);
      vi.mocked(userGetTopArtists).mockResolvedValue([]);
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
                  name: "get_recent_tracks",
                  input: { username: "customuser", limit: 3 },
                },
                {
                  type: "tool_use",
                  id: "tool_2",
                  name: "get_top_tracks",
                  input: { username: "customuser", period: "7day", limit: 5 },
                },
                {
                  type: "tool_use",
                  id: "tool_3",
                  name: "get_top_artists",
                  input: { username: "customuser", period: "overall" },
                },
                {
                  type: "tool_use",
                  id: "tool_4",
                  name: "get_top_albums",
                  input: { username: "anotheruser" },
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

      await collectResponses(
        createMessage([
          { role: "user", username: TEST_USERNAME, content: "Test" },
        ]),
      );

      expect(userGetRecentTracks).toHaveBeenCalledWith("customuser", {
        limit: 3,
      });
      expect(userGetTopTracks).toHaveBeenCalledWith("customuser", {
        period: "7day",
        limit: 5,
      });
      expect(userGetTopArtists).toHaveBeenCalledWith("customuser", {
        period: "overall",
        limit: 10,
      });
      expect(userGetTopAlbums).toHaveBeenCalledWith("anotheruser", {
        period: "1month",
        limit: 10,
      });
    });

    it("should call searchChannelMessages for search_messages tool", async () => {
      const mockSearchResult = {
        total_results: 1,
        hits: [
          {
            hit: {
              id: "1",
              username: "Alice",
              content: "hello world",
              timestamp: "2025-01-01T00:00:00.000000+00:00",
            },
            context: [],
          },
        ],
      };
      vi.mocked(searchChannelMessages).mockResolvedValue(mockSearchResult);

      let callCount = 0;

      server.use(
        http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
          callCount++;

          const toolUse = {
            type: "tool_use",
            id: "tool_1",
            name: "search_messages",
            input: {
              content: "hello",
              limit: 10,
              sort_by: "timestamp",
              sort_order: "asc",
            },
          };

          if (callCount === 1) {
            return HttpResponse.json({
              content: [toolUse],
              stop_reason: "tool_use",
            });
          }

          expect(await request.json()).toMatchObject({
            messages: [
              { role: "user", content: `${TEST_USERNAME}: Test` },
              { role: "assistant", content: [toolUse] },
              {
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    content: JSON.stringify(mockSearchResult),
                  },
                ],
              },
            ],
          });

          return HttpResponse.json({
            content: [{ type: "text", text: "found it" }],
            stop_reason: "end_turn",
          });
        }),
      );

      const responses = await collectResponses(
        createMessage([
          { role: "user", username: TEST_USERNAME, content: "Test" },
        ]),
      );

      expect(responses).toEqual(["found it"]);
      expect(searchChannelMessages).toHaveBeenCalledWith({
        content: "hello",
        limit: 10,
        sort_by: "timestamp",
        sort_order: "asc",
      });
    });
  });
});
