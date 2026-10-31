import { setTimeout as sleep } from "node:timers/promises";

import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { recordPost } from "@/lib/bans";
import {
  getChannelMessages,
  type Message,
  searchChannelMessages,
} from "@/lib/discord/api";
import { playCounts, plays, top } from "@/lib/listeningQuery";
import { log } from "@/lib/log";
import {
  buildMemoryContext,
  chatCategories,
  describeMiss,
  edit,
  forget,
  type Memory,
  recall,
  remember,
} from "@/lib/memory";
import { MIGRATIONS } from "@/lib/migrations";
import { addReaction } from "@/lib/reactions";
import { recentPlays } from "@/lib/scrobbles";
import type { Username } from "@/lib/session";
import { query } from "@/lib/turso";
import { getStats } from "@/lib/wakaTime";
import { server } from "@/mocks/node";
import { sqliteBeforeEach } from "@/mocks/sqlite";

import {
  type ChatMessage,
  createMessage,
  finalText,
  formatConversation,
  LISTENING_TOOLS,
  MEMORY_TOOLS,
  runAgentLoop,
} from "./anthropic";

vi.mock(import("node:timers/promises"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, setTimeout: vi.fn() };
});
vi.mock(import("@/lib/discord/api"), () => ({
  getChannelMessages: vi.fn(),
  searchChannelMessages: vi.fn(),
}));
vi.mock(import("@/lib/turso"), async () =>
  (await import("@/mocks/sqlite")).mockTurso(),
);
vi.mock(import("@/lib/reactions"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, addReaction: vi.fn() };
});
vi.mock(import("@/lib/memory"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    buildMemoryContext: vi.fn(async () => "<memory></memory>"),
    remember: vi.fn(),
    recall: vi.fn(async () => []),
    edit: vi.fn(),
    forget: vi.fn(),
  };
});
vi.mock(import("@/lib/wakaTime"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getStats: vi.fn() };
});
vi.mock(import("@/lib/listeningQuery"), async (importOriginal) => ({
  ...(await importOriginal()),
  plays: vi.fn(),
  top: vi.fn(),
  playCounts: vi.fn(),
}));
vi.mock(import("@/lib/scrobbles"), () => ({ recentPlays: vi.fn() }));

const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1/messages";
const TEST_USERNAME = "test-user";
const EPHEMERAL = { type: "ephemeral" };
// Sunday, 01:00 in Stockholm.
const NOW = "2026-10-25T00:00:00Z";

type RequestBody = {
  tool_choice?: unknown;
  cache_control?: unknown;
  system: Array<{ text: string }>;
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; content?: string }>;
  }>;
  tools: Array<{ name: string }>;
};

let requests: RequestBody[];
let headers: Headers[];

sqliteBeforeEach(query, MIGRATIONS);

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW), toFake: ["Date"] });
  requests = [];
  headers = [];
  vi.mocked(getStats).mockResolvedValue([]);
  vi.mocked(getChannelMessages).mockResolvedValue([]);
  vi.mocked(recentPlays).mockResolvedValue([]);
});

function conversation(author: string, text: string): string {
  return `<conversation today="Sunday 2026-10-25">\n<message author="${author}">${text}</message>\n</conversation>`;
}

function reply(content: unknown[], stop_reason = "end_turn") {
  return HttpResponse.json({ content, stop_reason });
}

function text(value: string) {
  return { type: "text", text: value };
}

function toolUse(name: string, input: object = {}, id = "tool_1") {
  return { type: "tool_use", id, name, input };
}

/** Answers each request with the next response; the last one repeats. */
function respond(...responses: Array<() => Response>) {
  server.use(
    http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
      requests.push((await request.json()) as RequestBody);
      headers.push(request.headers);
      const next = responses[Math.min(requests.length, responses.length) - 1];
      return next?.() ?? reply([]);
    }),
  );
}

function failOnce(failure: () => Response) {
  respond(failure, () => reply([]));
}

function ask(
  chat: [ChatMessage, ...ChatMessage[]] = [
    { role: "user", username: TEST_USERNAME, content: "Test" },
  ],
): Promise<string[]> {
  return Array.fromAsync(createMessage(chat));
}

/** Runs one tool call through a reply and returns what the model got back. */
async function runTool(
  name: string,
  input: object,
  chat?: [ChatMessage, ...ChatMessage[]],
): Promise<string> {
  respond(
    () => reply([toolUse(name, input)], "tool_use"),
    () => reply([text("done")]),
  );
  await ask(chat);
  const content = requests.at(-1)?.messages.at(-1)?.content;
  return Array.isArray(content) ? (content[0]?.content ?? "") : "";
}

describe("createMessage", () => {
  it("should create message and yield text content", async () => {
    respond(() => reply([text("Hello! How can I help you?")]));

    expect(
      await ask([
        { role: "user", username: TEST_USERNAME, content: "Hello, bot!" },
      ]),
    ).toEqual(["Hello! How can I help you?"]);
    expect(requests[0]).not.toHaveProperty("tool_choice");
    expect(requests[0]).toMatchObject({
      model: "claude-haiku-5-5",
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "medium" },
      max_tokens: 2048,
      cache_control: EPHEMERAL,
      system: [
        {
          type: "text",
          text: expect.stringContaining("simon-bot"),
          cache_control: EPHEMERAL,
        },
        { type: "text", text: expect.stringContaining("<memory>") },
      ],
      messages: [
        { role: "user", content: conversation(TEST_USERNAME, "Hello, bot!") },
      ],
      tools: [
        { name: "get_chat_history" },
        { name: "search_messages" },
        { name: "get_wakatime_stats" },
        { name: "get_recent_tracks" },
        { name: "get_plays" },
        { name: "get_top" },
        { name: "get_play_counts" },
        { name: "react" },
        { name: "ban" },
        { name: "remember" },
        { name: "recall" },
        { name: "edit" },
        { name: "forget" },
      ],
    });
    expect(headers[0]?.get("x-api-key")).toBe("test-anthropic-api-key");
    expect(headers[0]?.get("anthropic-version")).toBe("2023-06-01");
  });

  it("should send the whole conversation and build memory for its users only", async () => {
    vi.mocked(buildMemoryContext).mockResolvedValue("<memory>notes</memory>");
    respond(() => reply([text("I'm good!")]));
    const chat: [ChatMessage, ...ChatMessage[]] = [
      { role: "user", username: "Alice", content: "Hello" },
      { role: "assistant", username: "simon-bot", content: "Hi there!" },
      { role: "user", username: "Bob", content: "How are you?" },
    ];

    expect(await ask(chat)).toEqual(["I'm good!"]);

    expect(requests[0]?.messages).toEqual([
      { role: "user", content: formatConversation(chat) },
    ]);
    expect(buildMemoryContext).toHaveBeenCalledWith(
      chatCategories(["Alice", "Bob"]),
      undefined,
    );
    expect(requests[0]?.system[1]?.text).toBe("<memory>notes</memory>");
  });

  it("should omit the memory block when there is none", async () => {
    vi.mocked(buildMemoryContext).mockResolvedValue("");
    respond(() => reply([text("ok")]));

    expect(await ask()).toEqual(["ok"]);
    expect(requests[0]?.system).toHaveLength(1);
  });

  describe("memory tools", () => {
    const note: Memory = {
      id: 3,
      category: "self",
      content: "i like trains",
      createdAt: new Date(NOW),
      updatedAt: undefined,
    };
    const shown = { ...note, createdAt: "2026-10-25 02:00" };

    it.each([
      {
        tool: "remember",
        input: { category: "self", content: "i like trains" },
        run: remember,
        called: { category: "self", content: "i like trains" },
        stub: () =>
          vi.mocked(remember).mockResolvedValue({ status: "ok", memory: note }),
        expected: shown,
      },
      {
        tool: "recall",
        input: { category: "self" },
        run: recall,
        called: { category: "self", limit: 20 },
        stub: () => vi.mocked(recall).mockResolvedValue([note]),
        expected: [shown],
      },
      {
        tool: "edit",
        input: {
          id: 3,
          old_content: "i like cats",
          new_content: "i like trains",
          category: "self",
        },
        run: edit,
        called: {
          id: 3,
          oldContent: "i like cats",
          newContent: "i like trains",
          category: "self",
        },
        stub: () =>
          vi.mocked(edit).mockResolvedValue({ status: "ok", memory: note }),
        expected: shown,
      },
      {
        tool: "forget",
        input: { id: 3, content: "i like trains" },
        run: forget,
        called: { id: 3, content: "i like trains" },
        stub: () => vi.mocked(forget).mockResolvedValue({ status: "ok" }),
        expected: { forgotten: true },
      },
    ] as const)(
      "should run $tool on memory",
      async ({ tool, input, run, called, stub, expected }) => {
        stub();

        expect(JSON.parse(await runTool(tool, input))).toEqual(expected);
        expect(run).toHaveBeenCalledWith(called);
      },
    );

    it.each([
      {
        tool: "remember",
        input: { category: "self", content: "x" },
        run: remember,
      },
      {
        tool: "edit",
        input: { id: 3, old_content: "i like cats", new_content: "x" },
        run: edit,
      },
      { tool: "forget", input: { id: 3, content: "i like cats" }, run: forget },
    ] as const)(
      "should hand a $tool miss back to the model",
      async ({ tool, input, run }) => {
        const miss = { status: "stale", current: note } as const;
        vi.mocked(run).mockResolvedValue(miss);

        expect(JSON.parse(await runTool(tool, input))).toEqual({
          ...describeMiss(miss),
          current: shown,
        });
      },
    );
  });

  it("should configure fetch with 15 second timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    respond(() => reply([]));

    await ask();

    expect(timeoutSpy).toHaveBeenCalledWith(15_000);
  });

  it.each([
    { status: 400, statusText: "Bad Request" },
    { status: 401, statusText: "Unauthorized" },
  ])(
    "should throw HTTP $status with its body and no retry",
    async ({ status, statusText }) => {
      respond(
        () => new HttpResponse('{"error":"nope"}', { status, statusText }),
      );

      await expect(ask()).rejects.toThrow(
        `Anthropic API error: ${status} ${statusText}: {"error":"nope"}`,
      );
      expect(requests).toHaveLength(1);
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it.each([408, 429, 500, 529])(
    "should retry HTTP %i twice with backoff, then give up",
    async (status) => {
      respond(() => new HttpResponse("busy", { status }));

      await expect(ask()).rejects.toThrow(
        new RegExp(`^Anthropic API error: ${status} .*: busy$`),
      );
      expect(requests).toHaveLength(3);
      expect(vi.mocked(sleep).mock.calls).toEqual([[500], [1000]]);
    },
  );

  it.each([
    { case: "retry-after seconds", retryAfter: "8", sleep: 8000 },
    {
      case: "a retry-after date",
      retryAfter: new Date(Date.parse(NOW) + 2000).toUTCString(),
      sleep: 2000,
    },
    { case: "no retry-after", retryAfter: undefined, sleep: 500 },
    { case: "a zero retry-after", retryAfter: "0", sleep: 500 },
    { case: "a retry-after of neither kind", retryAfter: "soon", sleep: 500 },
    {
      case: "a retry-after date already past",
      retryAfter: "Wed, 21 Oct 2015 07:28:00 GMT",
      sleep: 500,
    },
  ])("should wait for $case", async ({ retryAfter, sleep: expected }) => {
    vi.useFakeTimers({ now: new Date(NOW), toFake: ["Date"] });
    failOnce(
      () =>
        new HttpResponse(null, {
          status: 429,
          headers:
            retryAfter === undefined ? {} : { "retry-after": retryAfter },
        }),
    );

    await ask();

    expect(vi.mocked(sleep).mock.calls).toEqual([[expected]]);
  });

  it("should not sleep past the retry limit per request", async () => {
    respond(
      () =>
        new HttpResponse("slow down", {
          status: 429,
          headers: { "retry-after": "11" },
        }),
    );

    await expect(ask()).rejects.toThrow(
      "Anthropic API error: 429 Too Many Requests: slow down",
    );
    expect(requests).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("should fail a body that times out, naming its status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Object.assign(new Response(null, { status: 503 }), {
        text: () =>
          Promise.reject(new DOMException("timed out", "TimeoutError")),
      }),
    );

    await expect(ask()).rejects.toThrow(
      "Anthropic API error: could not read the body of a 503 response",
    );
    expect(sleep).not.toHaveBeenCalled();
  });

  it("should retry a connection dropped mid-body", async () => {
    // Node's body read rejects with this; happy-dom's would wrap it in an EncodingError.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Object.assign(new Response(), {
        json: () => Promise.reject(new TypeError("terminated")),
      }),
    );
    respond(() => reply([text("whole this time")]));

    expect(await ask()).toEqual(["whole this time"]);
    expect(log.warn).toHaveBeenCalledWith(
      {
        loop: "reply",
        err: expect.objectContaining({
          message:
            "Anthropic API error: could not read the body of a 200 response",
          cause: new TypeError("terminated"),
        }),
        delayMs: 500,
      },
      "simon-bot retrying request",
    );
    expect(vi.mocked(sleep).mock.calls).toEqual([[500]]);
  });

  it("should cut a long error body short", async () => {
    respond(() => new HttpResponse("x".repeat(1000), { status: 400 }));

    await expect(ask()).rejects.toThrow(/: x{500}$/);
  });

  it("should retry a request that never connected", async () => {
    const failure = new TypeError("fetch failed");
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(failure);
    respond(() => reply([text("connected")]));

    expect(await ask()).toEqual(["connected"]);
    expect(log.warn).toHaveBeenCalledWith(
      { loop: "reply", err: failure, delayMs: 500 },
      "simon-bot retrying request",
    );
    expect(vi.mocked(sleep).mock.calls).toEqual([[500]]);
  });

  it("should not retry a timeout", async () => {
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(
      AbortSignal.abort(new DOMException("timed out", "TimeoutError")),
    );
    respond(() => reply([]));

    await expect(ask()).rejects.toMatchObject({ name: "TimeoutError" });
    expect(requests).toHaveLength(0);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("should handle invalid response schema", async () => {
    respond(() => HttpResponse.json({ invalid: "data" }));

    await expect(ask()).rejects.toBeInstanceOf(z.ZodError);
    expect(requests).toHaveLength(1);
  });

  it("should log every turn with its stop reason, blocks and usage", async () => {
    const usage = {
      input_tokens: 1200,
      output_tokens: 40,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 0,
    };
    respond(() =>
      HttpResponse.json({
        content: [
          { type: "thinking", thinking: "they just said hi", signature: "s" },
          text("hi"),
        ],
        stop_reason: "end_turn",
        usage,
      }),
    );

    await ask();

    expect(log.info).toHaveBeenCalledWith(
      {
        loop: "reply",
        stopReason: "end_turn",
        blocks: ["thinking", "text"],
        usage,
      },
      "simon-bot turn",
    );
    expect(log.info).toHaveBeenCalledWith(
      { loop: "reply", thinking: "they just said hi" },
      "simon-bot thinking",
    );
  });

  it("should not log a thinking block the API left empty", async () => {
    respond(() =>
      reply([{ type: "thinking", thinking: "", signature: "s" }, text("hi")]),
    );

    await ask();

    expect(log.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "simon-bot thinking",
    );
  });

  it("should handle response with no content blocks", async () => {
    respond(() => reply([]));

    expect(await ask()).toEqual([]);
  });

  it("should yield only the fallback when a response is refused", async () => {
    respond(() => reply([text("here's how you do it")], "refusal"));

    expect(await ask()).toEqual(["yeah I'm not touching that one, sorry"]);
    expect(log.warn).toHaveBeenCalledWith(
      { loop: "reply" },
      "simon-bot response was refused",
    );
  });

  it.each([
    {
      case: "after its text",
      content: [text("so anyway I was thinking abo")],
      expected: ["so anyway I was thinking abo"],
    },
    {
      case: "when the limit leaves no text",
      content: [{ type: "thinking", thinking: "...", signature: "sig" }],
      expected: [],
    },
  ])("should say it ran out of words $case", async ({ content, expected }) => {
    respond(() => reply(content, "max_tokens"));

    expect(await ask()).toEqual([
      ...expected,
      "...welp, ran out of words there",
    ]);
    expect(log.warn).toHaveBeenCalledWith(
      { loop: "reply" },
      "simon-bot response hit the token limit",
    );
  });

  it("should execute tools, keeping every block in the history", async () => {
    const thinking = { type: "thinking", thinking: "hmm", signature: "sig" };
    const use = toolUse("get_wakatime_stats");
    respond(
      () => reply([thinking, text("let me check..."), use], "tool_use"),
      () => reply([text("mostly typescript!")]),
    );

    expect(await ask()).toEqual(["let me check...", "mostly typescript!"]);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages).toEqual([
      { role: "user", content: conversation(TEST_USERNAME, "Test") },
      { role: "assistant", content: [thinking, text("let me check..."), use] },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tool_1", content: "[]" },
        ],
      },
    ]);
  });

  it("should rule out tools on the last iteration, say so, and cache only what is read", async () => {
    respond(
      ...Array.from(
        { length: 4 },
        (_, i) => () =>
          reply([toolUse("get_wakatime_stats", {}, `tool_${i}`)], "tool_use"),
      ),
      () => reply([text("here's what I found")]),
    );

    expect(await ask()).toEqual(["here's what I found"]);
    expect(requests.map((body) => body.tool_choice)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      { type: "none" },
    ]);
    expect(requests.map((body) => body.cache_control)).toEqual([
      EPHEMERAL,
      EPHEMERAL,
      EPHEMERAL,
      undefined,
      undefined,
    ]);
    const lastBlocks = requests.map(({ messages }) => {
      const content = messages.at(-1)?.content;
      return Array.isArray(content) ? content.at(-1) : content;
    });
    expect(lastBlocks.slice(1, 4)).toEqual([
      expect.objectContaining({ type: "tool_result" }),
      expect.objectContaining({ type: "tool_result" }),
      expect.objectContaining({ type: "tool_result" }),
    ]);
    expect(lastBlocks[4]).toEqual({
      type: "text",
      text: expect.stringContaining("Tools are off"),
    });
  });

  it("should keep tools on the last iteration when the loop opts out of ending in text", async () => {
    respond(() =>
      reply(
        [{ type: "text", text: "checking" }, toolUse("recall")],
        "tool_use",
      ),
    );

    const loop = runAgentLoop({
      system: [],
      messages: [{ role: "user", content: "reflect" }],
      tools: MEMORY_TOOLS,
      effort: "high",
      maxTokens: 8192,
      timeoutMs: 60_000,
      maxRetrySleepMs: 30_000,
      maxIterations: 2,
      endInText: false,
      loop: "reflection",
    });
    let next = await loop.next();
    while (next.done !== true) next = await loop.next();

    expect(next.value).toEqual({ end: "max_iterations", text: "" });
    expect(requests.map((body) => body.tool_choice)).toEqual([
      undefined,
      undefined,
    ]);
    expect(requests.map((body) => body.cache_control)).toEqual([
      EPHEMERAL,
      undefined,
    ]);
    expect(log.warn).toHaveBeenCalledWith(
      { loop: "reflection", iterations: 2 },
      "simon-bot reached max tool iterations",
    );
  });

  it.each([
    {
      case: "an unknown tool",
      use: toolUse("unknown_tool"),
      rejection: undefined,
      result: JSON.stringify({ error: "Unknown tool: unknown_tool" }),
    },
    {
      case: "invalid input",
      use: toolUse("get_recent_tracks", { limit: 999 }),
      rejection: undefined,
      result: expect.stringContaining("limit"),
    },
    {
      case: "a range that ends before it starts",
      use: toolUse("get_plays", { from: "2016-01-01", to: "2015-01-01" }),
      rejection: undefined,
      result: expect.stringContaining("from must be on or before to"),
    },
    {
      case: "a tool that throws",
      use: toolUse("get_wakatime_stats"),
      rejection: new Error("Network failure"),
      result: JSON.stringify({ error: "Network failure" }),
    },
    {
      case: "a tool that throws a non-Error",
      use: toolUse("get_wakatime_stats"),
      rejection: "string error",
      result: JSON.stringify({ error: "Unknown error" }),
    },
  ])(
    "should hand the model an error for $case",
    async ({ use, rejection, result }) => {
      if (rejection !== undefined) {
        vi.mocked(getStats).mockRejectedValue(rejection);
      }
      respond(
        () => reply([use], "tool_use"),
        () => reply([text("handled")]),
      );

      expect(await ask()).toEqual(["handled"]);
      expect(requests[1]?.messages.at(-1)).toEqual({
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tool_1", content: result },
        ],
      });
    },
  );

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
    vi.mocked(recentPlays).mockResolvedValue(mockTracks);
    respond(
      () =>
        reply(
          [
            toolUse("get_wakatime_stats", {}, "tool_1"),
            toolUse("get_recent_tracks", { limit: 5 }, "tool_2"),
          ],
          "tool_use",
        ),
      () => reply([text("got both results")]),
    );

    expect(await ask()).toEqual(["got both results"]);
    expect(requests[1]?.messages.at(-1)?.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "tool_1",
        content: JSON.stringify(mockStats),
      },
      {
        type: "tool_result",
        tool_use_id: "tool_2",
        content: JSON.stringify(mockTracks),
      },
    ]);
  });

  it("should yield multiple text blocks from single response", async () => {
    respond(() => reply([text("First part. "), text("Second part.")]));

    expect(await ask()).toEqual(["First part. ", "Second part."]);
  });

  describe("tool execution", () => {
    const searchInput = {
      content: "hello",
      limit: 10,
      sort_by: "timestamp",
      sort_order: "asc",
    } as const;

    type Lookup = (...args: never[]) => Promise<unknown>;

    function wiring<F extends Lookup>(
      tool: string,
      input: object,
      mock: F,
      ...calledWith: Parameters<F>
    ): { tool: string; input: object; mock: Lookup; calledWith: unknown[] } {
      return { tool, input, mock, calledWith };
    }

    it.each([
      wiring(
        "get_wakatime_stats",
        { period: "last_30_days", limit: 10 },
        getStats,
        "last_30_days",
        10,
      ),
      wiring("get_recent_tracks", { limit: 10 }, recentPlays, 10),
      wiring(
        "get_plays",
        { artist: "Radiohead", loved: true, order: "oldest", limit: 1 },
        plays,
        { artist: "Radiohead", loved: true },
        "oldest",
        1,
      ),
      wiring(
        "get_top",
        { from: "2015-01-01", to: "2015-12-31", group_by: "album", limit: 5 },
        top,
        {
          from: new Date("2014-12-31T23:00:00Z"),
          to: new Date("2015-12-31T23:00:00Z"),
        },
        "album",
        5,
      ),
      wiring(
        "get_play_counts",
        { track: "Idioteque", per: "month", order: "plays", limit: 3 },
        playCounts,
        { track: "Idioteque" },
        "month",
        "plays",
        3,
      ),
      wiring(
        "search_messages",
        searchInput,
        searchChannelMessages,
        searchInput,
      ),
    ])(
      "should hand $tool its input and the model its result",
      async ({ tool, input, mock, calledWith }) => {
        const data = [{ from: tool }];
        vi.mocked(mock).mockResolvedValue(data);

        expect(await runTool(tool, input)).toBe(JSON.stringify(data));
        expect(mock).toHaveBeenCalledWith(...calledWith);
      },
    );

    it("should give chat history in time order with site reactions", async () => {
      const message = (
        id: string,
        timestamp: string,
        replies: Message[] = [],
      ): Message => ({
        id,
        user: { name: "otter", color: "hsl(1 2% 3%)" as const },
        content: `hi ${id}`,
        edited: false,
        timestamp: new Date(timestamp),
        reactions: [],
        replies,
      });
      vi.mocked(getChannelMessages).mockResolvedValue([
        message("1", "2026-10-24T20:00:00Z", [
          message("3", "2026-10-24T23:30:00Z"),
        ]),
        message("2", "2026-10-24T21:00:00Z"),
      ]);
      await query(
        "INSERT INTO reactions (message_id, emoji, username) VALUES ('3', '👍', 'simon-bot')",
      );

      expect(await runTool("get_chat_history", { limit: 5 })).toBe(
        [
          '<message id="1" author="otter" time="2026-10-24 22:00">hi 1</message>',
          '<message id="2" author="otter" time="2026-10-24 23:00">hi 2</message>',
          '<message id="3" author="otter" time="2026-10-25 01:30" reply_to="1" reactions="👍 1 (you)">hi 3</message>',
        ].join("\n"),
      );
      expect(getChannelMessages).toHaveBeenCalledWith(5);
    });

    it("should give an invalid time as null rather than fail the tool", async () => {
      vi.mocked(recentPlays).mockResolvedValue([
        {
          name: "Idioteque",
          artist: "Radiohead",
          album: "Kid A",
          playedAt: new Date(Number.NaN),
          nowPlaying: false,
          loved: false,
        },
      ]);

      expect(JSON.parse(await runTool("get_recent_tracks", {}))).toMatchObject([
        { name: "Idioteque", playedAt: null },
      ]);
    });

    it("should give plays as Stockholm times", async () => {
      vi.mocked(plays).mockResolvedValue({
        total: 1,
        plays: [
          {
            name: "Idioteque",
            artist: "Radiohead",
            album: "Kid A",
            playedAt: new Date("2015-12-30T23:30:00Z"),
            loved: false,
          },
        ],
      });

      expect(JSON.parse(await runTool("get_plays", {}))).toMatchObject({
        plays: [{ playedAt: "2015-12-31 00:30" }],
      });
    });

    it("should describe tool inputs as the model writes them", async () => {
      respond(() => reply([]));
      await ask();

      const tools = requests[0]?.tools as unknown as Array<{
        name: string;
        input_schema: { required?: string[]; $schema?: string };
      }>;
      const range = tools.find(({ name }) => name === "get_top");
      expect(range?.input_schema.required).toEqual(["group_by"]);
      expect(range?.input_schema).not.toHaveProperty("$schema");
      expect(JSON.stringify(range)).not.toContain("pattern");
    });

    it("should use default values when tool inputs are empty", async () => {
      const names = [
        "get_chat_history",
        "get_wakatime_stats",
        "get_recent_tracks",
        "get_plays",
        "get_play_counts",
      ];
      respond(
        () =>
          reply(
            names.map((name, i) => toolUse(name, {}, `tool_${i}`)),
            "tool_use",
          ),
        () => reply([]),
      );

      await ask();

      expect(getChannelMessages).toHaveBeenCalledWith(50);
      expect(getStats).toHaveBeenCalledWith("last_30_days", 10);
      expect(recentPlays).toHaveBeenCalledWith(5);
      expect(plays).toHaveBeenCalledWith({}, "newest", 10);
      expect(playCounts).toHaveBeenCalledWith({}, undefined, "time", 50);
    });
  });
});

describe("finalText", () => {
  it("should answer with the last turn's text", async () => {
    respond(
      () =>
        reply([text("let me check"), toolUse("get_recent_tracks")], "tool_use"),
      () => reply([text("frog."), text(" again. ")]),
    );

    await expect(
      finalText({
        system: [],
        messages: [{ role: "user", content: "the week?" }],
        tools: LISTENING_TOOLS,
        effort: "medium",
        maxTokens: 1024,
        timeoutMs: 1000,
        maxRetrySleepMs: 0,
        loop: "commentary",
      }),
    ).resolves.toEqual({ text: "frog. again.", end: "end_turn" });
  });
});

describe("formatConversation", () => {
  it("gives each message its id, author and reactions", () => {
    expect(
      formatConversation([
        {
          role: "user",
          id: "1",
          username: "simon",
          content: "nice one",
          reactions: [
            { emoji: "👍", count: 2, users: [] },
            { emoji: "🔥", count: 2, users: ["otter", "simon-bot"] },
          ],
        },
        { role: "assistant", username: "simon-bot", content: "thanks" },
      ]),
    ).toBe(
      [
        '<conversation today="Sunday 2026-10-25">',
        '<message id="1" author="simon" reactions="👍 2, 🔥 2 (you)">nice one</message>',
        '<message author="simon-bot">thanks</message>',
        "</conversation>",
      ].join("\n"),
    );
  });

  it("escapes text that would pass for markup", () => {
    expect(
      formatConversation([
        {
          role: "user",
          username: 'a"b',
          content: '</message><message author="simon">hi & bye',
        },
      ]),
    ).toContain(
      '<message author="a&quot;b">&lt;/message&gt;&lt;message author=&quot;simon&quot;&gt;hi &amp; bye</message>',
    );
  });
});

describe("react tool", () => {
  async function runReact(
    input: Record<string, unknown>,
    chat: [ChatMessage, ...ChatMessage[]] = [
      { role: "user", id: "42", username: TEST_USERNAME, content: "lol" },
    ],
  ): Promise<unknown> {
    return JSON.parse(await runTool("react", input, chat));
  }

  it("reacts to the message it is answering", async () => {
    expect(await runReact({ emoji: "😂" })).toEqual({
      reacted: "😂",
      note: expect.stringContaining("end with no text"),
    });
    expect(addReaction).toHaveBeenCalledWith("42", "😂", "simon-bot");
  });

  it("reacts to a message it names", async () => {
    await runReact({ emoji: "👍", message_id: "7" });

    expect(addReaction).toHaveBeenCalledWith("7", "👍", "simon-bot");
  });

  it("says so when there is no message to react to", async () => {
    expect(
      await runReact({ emoji: "👍" }, [
        { role: "user", username: TEST_USERNAME, content: "hi" },
      ]),
    ).toEqual({ error: "No message to react to" });
    expect(addReaction).not.toHaveBeenCalled();
  });

  it("offers a schema without the emoji pattern", async () => {
    respond(() => reply([]));

    await ask();

    const tool = requests[0]?.tools.find(({ name }) => name === "react");
    expect(JSON.stringify(tool)).not.toContain("RGI_Emoji");
  });

  it("turns away anything but one emoji", async () => {
    expect(await runReact({ emoji: "lol" })).toEqual({
      error: expect.any(String),
    });
    expect(addReaction).not.toHaveBeenCalled();
  });
});

describe("ban tool", () => {
  const chat: [ChatMessage] = [
    { role: "user", id: "42", username: TEST_USERNAME, content: "spam" },
  ];

  it("bans the author of the message it is answering", async () => {
    await recordPost("42", TEST_USERNAME as Username, "192.0.2.1");

    expect(JSON.parse(await runTool("ban", {}, chat))).toEqual({
      banned: TEST_USERNAME,
    });
  });

  it.each([
    ["a post without an IP", { message_id: "7" }, chat],
    [
      "no message",
      {},
      [{ role: "user", username: TEST_USERNAME, content: "hi" }] as const,
    ],
  ])("says so for %s", async (_, input, messages) => {
    expect(JSON.parse(await runTool("ban", input, [...messages]))).toEqual({
      error: "No site post from the last 30 days to ban for",
    });
  });
});
