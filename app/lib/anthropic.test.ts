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
        expect(await request.json()).toMatchObject({
          model: "claude-haiku-4-5",
          max_tokens: 500,
          system: expect.stringContaining("simon-bot"),
          messages: [{ role: "user", content: "Hello, bot!" }],
          tools: [
            { name: "get_chat_history" },
            { name: "get_wakatime_stats" },
            { name: "get_recent_tracks" },
            { name: "get_top_tracks" },
            { name: "get_top_artists" },
            { name: "get_top_albums" },
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

        const thinkingBlock = { type: "thinking" };
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
            { role: "user", content: "Test" },
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

    const responses = await collectResponses(createMessage("Test"));

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
              { role: "user", content: "what languages has simon been using?" },
            ],
          });
          return HttpResponse.json({
            content: [textBlock, toolUse],
            stop_reason: "tool_use",
          });
        }

        expect(await request.json()).toMatchObject({
          messages: [
            { role: "user", content: "what languages has simon been using?" },
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

    expect(responses).toEqual([
      "sorry, I got stuck in a loop and couldn't finish my thought...",
    ]);
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
            { role: "user", content: "Test" },
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

    const responses = await collectResponses(createMessage("Test"));

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
            { role: "user", content: "Test" },
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

    const responses = await collectResponses(createMessage("Test"));

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
            { role: "user", content: "Test" },
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
            { role: "user", content: "Test" },
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

    const responses = await collectResponses(createMessage("Test"));

    expect(responses).toEqual(["handled error"]);
  });

  describe("tool execution", () => {
    it("should call getChannelMessages for get_chat_history tool", async () => {
      const mockMessages = [
        {
          id: "1",
          user: { name: "User1", color: "hsl(0 50% 50%)" as const },
          content: "Hello",
          edited: false,
          replies: [],
        },
        {
          id: "2",
          user: { name: "User2", color: "hsl(120 50% 50%)" as const },
          content: "World",
          edited: false,
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
              { role: "user", content: "Test" },
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

      await collectResponses(createMessage("Test"));

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
              { role: "user", content: "Test" },
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

      await collectResponses(createMessage("Test"));

      expect(userGetTopTracks).toHaveBeenCalledWith("magijo", {
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
              { role: "user", content: "Test" },
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

      await collectResponses(createMessage("Test"));

      expect(userGetTopArtists).toHaveBeenCalledWith("magijo", {
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
              { role: "user", content: "Test" },
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

      await collectResponses(createMessage("Test"));

      expect(userGetTopAlbums).toHaveBeenCalledWith("magijo", {
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
              { role: "user", content: "Test" },
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

      await collectResponses(createMessage("Test"));

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
              { role: "user", content: "Test" },
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

      await collectResponses(createMessage("Test"));

      expect(userGetRecentTracks).toHaveBeenCalledWith("magijo", { limit: 10 });
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

      await collectResponses(createMessage("Test"));

      expect(getChannelMessages).toHaveBeenCalledWith(10);
      expect(getStats).toHaveBeenCalledWith("last_7_days", 5);
      expect(userGetRecentTracks).toHaveBeenCalledWith("magijo", { limit: 5 });
      expect(userGetTopTracks).toHaveBeenCalledWith("magijo", {
        period: "1month",
        limit: 5,
      });
      expect(userGetTopArtists).toHaveBeenCalledWith("magijo", {
        period: "1month",
        limit: 5,
      });
      expect(userGetTopAlbums).toHaveBeenCalledWith("magijo", {
        period: "1month",
        limit: 5,
      });
    });
  });
});
