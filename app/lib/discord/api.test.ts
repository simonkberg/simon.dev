import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import type { Username } from "@/lib/session";
import { server } from "@/mocks/node";

import {
  _resetRateLimitState,
  _setRateLimitGate,
  getChannelMessages,
  getMessageChain,
  postChannelMessage,
} from "./api";

vi.mock(import("server-only"), () => ({}));

const DISCORD_BASE_URL = "https://discord.com/api/v10";

describe("getChannelMessages", () => {
  it("should fetch and parse messages successfully", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([
          {
            type: 0,
            id: "1",
            author: { id: "user1" },
            content: "TestUser: Hello world",
            edited_timestamp: null,
          },
        ]),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([
      {
        id: "1",
        content: "Hello world",
        edited: false,
        user: { name: "TestUser" },
      },
    ]);
  });

  it("should parse markdown to HTML in content", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([
          {
            type: 0,
            id: "1",
            author: { id: "user1" },
            content: "TestUser: **Bold** and *italic*",
            edited_timestamp: null,
          },
        ]),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([
      { content: "<strong>Bold</strong> and <em>italic</em>" },
    ]);
  });

  it("should lookup user via guild member API when no prefix", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([
          {
            type: 0,
            id: "1",
            author: { id: "user123" },
            content: "No prefix here",
            edited_timestamp: null,
          },
        ]),
      ),
      http.get(
        `${DISCORD_BASE_URL}/guilds/:guildId/members/:userId`,
        ({ params }) => {
          expect(params["userId"]).toBe("user123");
          return HttpResponse.json({
            user: { username: "discorduser", global_name: "Discord User" },
            nick: "Server Nick",
          });
        },
      ),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([
      { content: "No prefix here", user: { name: "Server Nick" } },
    ]);
  });

  it("should use global_name when nick is null", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([
          {
            type: 0,
            id: "1",
            author: { id: "user456" },
            content: "Message",
            edited_timestamp: null,
          },
        ]),
      ),
      http.get(`${DISCORD_BASE_URL}/guilds/:guildId/members/:userId`, () =>
        HttpResponse.json({
          user: { username: "discorduser", global_name: "Global Name" },
          nick: null,
        }),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([{ user: { name: "Global Name" } }]);
  });

  it("should use username when nick and global_name are null", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([
          {
            type: 0,
            id: "1",
            author: { id: "user789" },
            content: "Message",
            edited_timestamp: null,
          },
        ]),
      ),
      http.get(`${DISCORD_BASE_URL}/guilds/:guildId/members/:userId`, () =>
        HttpResponse.json({
          user: { username: "fallbackuser", global_name: null },
          nick: null,
        }),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([{ user: { name: "fallbackuser" } }]);
  });

  it("should handle edited messages", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([
          {
            type: 0,
            id: "1",
            author: { id: "user1" },
            content: "User: Edited message",
            edited_timestamp: "2024-01-01T00:00:00Z",
          },
        ]),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([{ edited: true }]);
  });

  it("should handle replies as nested messages with multiple levels", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([
          {
            type: 0,
            id: "1",
            author: { id: "user1" },
            content: "User1: Parent message",
            edited_timestamp: null,
          },
          {
            type: 19,
            id: "2",
            author: { id: "user2" },
            content: "User2: First reply",
            edited_timestamp: null,
            message_reference: { message_id: "1" },
          },
          {
            type: 19,
            id: "3",
            author: { id: "user3" },
            content: "User3: Reply to reply",
            edited_timestamp: null,
            message_reference: { message_id: "2" },
          },
          {
            type: 19,
            id: "4",
            author: { id: "user4" },
            content: "User4: Another top-level reply",
            edited_timestamp: null,
            message_reference: { message_id: "1" },
          },
        ]),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([
      {
        id: "1",
        content: "Parent message",
        replies: [
          {
            id: "2",
            content: "First reply",
            replies: [{ id: "3", content: "Reply to reply" }],
          },
          { id: "4", content: "Another top-level reply" },
        ],
      },
    ]);
  });

  it("should exclude replies that reference missing parent messages", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([
          {
            type: 0,
            id: "1",
            author: { id: "user1" },
            content: "User1: Message 1",
            edited_timestamp: null,
          },
          {
            type: 19,
            id: "2",
            author: { id: "user2" },
            content: "User2: Valid reply to message 1",
            edited_timestamp: null,
            message_reference: { message_id: "1" },
          },
          {
            type: 19,
            id: "3",
            author: { id: "user3" },
            content: "User3: Orphaned reply",
            edited_timestamp: null,
            message_reference: { message_id: "999" },
          },
        ]),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([{ id: "1", replies: [{ id: "2" }] }]);
  });

  it("should filter out non-standard message types", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([
          {
            type: 0,
            id: "1",
            author: { id: "user1" },
            content: "User: Normal message",
            edited_timestamp: null,
          },
          {
            type: 7,
            id: "2",
            author: { id: "user2" },
            content: "User joined",
            edited_timestamp: null,
          },
          {
            type: 18,
            id: "3",
            author: { id: "user3" },
            content: "Thread created",
            edited_timestamp: null,
          },
        ]),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([{ id: "1" }]);
  });

  it("should sort messages by ID", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([
          {
            type: 0,
            id: "3",
            author: { id: "user1" },
            content: "User: Third",
            edited_timestamp: null,
          },
          {
            type: 0,
            id: "1",
            author: { id: "user1" },
            content: "User: First",
            edited_timestamp: null,
          },
          {
            type: 0,
            id: "2",
            author: { id: "user1" },
            content: "User: Second",
            edited_timestamp: null,
          },
        ]),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages.map((m) => m.id)).toEqual(["1", "2", "3"]);
  });

  it("should configure fetch with 5 second timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([]),
      ),
    );

    await getChannelMessages();

    expect(timeoutSpy).toHaveBeenCalledWith(5000);
    timeoutSpy.mockRestore();
  });

  it.each([
    { status: 401, statusText: "Unauthorized" },
    { status: 403, statusText: "Forbidden" },
    { status: 404, statusText: "Not Found" },
    { status: 500, statusText: "Internal Server Error" },
  ])("should handle HTTP $status error", async ({ status, statusText }) => {
    vi.spyOn(log, "error").mockImplementation(() => {});

    server.use(
      http.get(
        `${DISCORD_BASE_URL}/channels/:channelId/messages`,
        () => new HttpResponse(JSON.stringify({}), { status, statusText }),
      ),
    );

    await expect(getChannelMessages()).rejects.toThrow(
      `Discord API error: ${status} ${statusText}`,
    );
  });

  it("should handle invalid response schema", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json({ invalid: "data" }),
      ),
    );

    await expect(getChannelMessages()).rejects.toThrow();
  });
});

describe("getMessageChain", () => {
  // NOTE: Each test uses unique message IDs to avoid DataLoader cache conflicts
  // between tests. The discordMessageLoader caches by message ID.

  it("should return single message when no parent", async () => {
    server.use(
      http.get(
        `${DISCORD_BASE_URL}/channels/:channelId/messages/:messageId`,
        () =>
          HttpResponse.json({
            type: 0,
            id: "single-1",
            author: { id: "user1" },
            content: "User1: Hello",
            edited_timestamp: null,
          }),
      ),
    );

    const chain = await getMessageChain("single-1");

    expect(chain).toHaveLength(1);
    expect(chain[0]).toMatchObject({ id: "single-1", content: "Hello" });
  });

  it("should walk up the chain to root (ordered root-first)", async () => {
    server.use(
      http.get(
        `${DISCORD_BASE_URL}/channels/:channelId/messages/:messageId`,
        ({ params }) => {
          const id = params["messageId"];
          if (id === "chain-3") {
            return HttpResponse.json({
              type: 19,
              id: "chain-3",
              author: { id: "user3" },
              content: "User3: Third",
              edited_timestamp: null,
              message_reference: { message_id: "chain-2" },
            });
          }
          if (id === "chain-2") {
            return HttpResponse.json({
              type: 19,
              id: "chain-2",
              author: { id: "user2" },
              content: "User2: Second",
              edited_timestamp: null,
              message_reference: { message_id: "chain-1" },
            });
          }
          return HttpResponse.json({
            type: 0,
            id: "chain-1",
            author: { id: "user1" },
            content: "User1: First",
            edited_timestamp: null,
          });
        },
      ),
    );

    const chain = await getMessageChain("chain-3");

    expect(chain).toHaveLength(3);
    expect(chain.map((m) => m.id)).toEqual(["chain-1", "chain-2", "chain-3"]);
    expect(chain.map((m) => m.content)).toEqual(["First", "Second", "Third"]);
  });

  it("should parse bot messages like any other prefixed message", async () => {
    server.use(
      http.get(
        `${DISCORD_BASE_URL}/channels/:channelId/messages/:messageId`,
        ({ params }) => {
          const id = params["messageId"];
          if (id === "bot-2") {
            return HttpResponse.json({
              type: 19,
              id: "bot-2",
              author: { id: "user2" },
              content: "User2: Thanks bot!",
              edited_timestamp: null,
              message_reference: { message_id: "bot-1" },
            });
          }
          return HttpResponse.json({
            type: 0,
            id: "bot-1",
            author: { id: "bot" },
            content: "simon-bot: Hello human",
            edited_timestamp: null,
          });
        },
      ),
    );

    const chain = await getMessageChain("bot-2");

    expect(chain).toHaveLength(2);
    expect(chain[0]).toMatchObject({
      id: "bot-1",
      username: "simon-bot",
      content: "Hello human",
    });
    expect(chain[1]).toMatchObject({
      id: "bot-2",
      username: "User2",
      content: "Thanks bot!",
    });
  });

  it("should lookup username via API when no prefix", async () => {
    server.use(
      http.get(
        `${DISCORD_BASE_URL}/channels/:channelId/messages/:messageId`,
        () =>
          HttpResponse.json({
            type: 0,
            id: "noprefix-1",
            author: { id: "user999" },
            content: "No prefix here",
            edited_timestamp: null,
          }),
      ),
      http.get(
        `${DISCORD_BASE_URL}/guilds/:guildId/members/:userId`,
        ({ params }) => {
          expect(params["userId"]).toBe("user999");
          return HttpResponse.json({
            user: { username: "discorduser", global_name: "Discord User" },
            nick: "Server Nick",
          });
        },
      ),
    );

    const chain = await getMessageChain("noprefix-1");

    expect(chain).toHaveLength(1);
    expect(chain[0]).toMatchObject({
      username: "Server Nick",
      content: "No prefix here",
    });
  });

  it("should stop on circular reference", async () => {
    server.use(
      http.get(
        `${DISCORD_BASE_URL}/channels/:channelId/messages/:messageId`,
        ({ params }) => {
          const id = params["messageId"];
          if (id === "circular-2") {
            return HttpResponse.json({
              type: 19,
              id: "circular-2",
              author: { id: "user2" },
              content: "User2: Reply",
              edited_timestamp: null,
              message_reference: { message_id: "circular-1" },
            });
          }
          // circular-1 points back to circular-2 (circular)
          return HttpResponse.json({
            type: 0,
            id: "circular-1",
            author: { id: "user1" },
            content: "User1: First",
            edited_timestamp: null,
            message_reference: { message_id: "circular-2" },
          });
        },
      ),
    );

    const chain = await getMessageChain("circular-2");

    // Should stop after detecting the cycle
    expect(chain).toHaveLength(2);
    expect(chain.map((m) => m.id)).toEqual(["circular-1", "circular-2"]);
  });

  it("should throw when API returns error", async () => {
    vi.spyOn(log, "error").mockImplementation(() => {});

    server.use(
      http.get(
        `${DISCORD_BASE_URL}/channels/:channelId/messages/:messageId`,
        () => HttpResponse.json({}, { status: 404, statusText: "Not Found" }),
      ),
    );

    await expect(getMessageChain("error-msg-1")).rejects.toThrow(
      "Discord API error: 404 Not Found",
    );
  });

  it("should limit chain depth to 50 messages", async () => {
    let callCount = 0;
    server.use(
      http.get(
        `${DISCORD_BASE_URL}/channels/:channelId/messages/:messageId`,
        ({ params }) => {
          callCount++;
          const id = Number(params["messageId"]);
          const parentId = id - 1;
          return HttpResponse.json({
            type: parentId > 0 ? 19 : 0,
            id: String(id),
            author: { id: "user1" },
            content: `User1: Message ${id}`,
            edited_timestamp: null,
            ...(parentId > 0 && {
              message_reference: { message_id: String(parentId) },
            }),
          });
        },
      ),
    );

    // Start from message 100 (would be 100 messages deep without limit)
    const chain = await getMessageChain("100");

    expect(chain).toHaveLength(50);
    expect(callCount).toBe(50);
  });
});

describe("postChannelMessage", () => {
  it("should post message with username prefix", async () => {
    server.use(
      http.post(
        `${DISCORD_BASE_URL}/channels/:channelId/messages`,
        async ({ request }) => {
          const body = (await request.json()) as { content: string };
          expect(body.content).toBe("TestUser: Hello world");
          expect(request.headers.get("Authorization")).toBe(
            "Bot test-discord-bot-token",
          );
          return HttpResponse.json({ id: "123" });
        },
      ),
    );

    await postChannelMessage("Hello world", "TestUser" as Username);
  });

  it("should return the message ID from Discord", async () => {
    server.use(
      http.post(
        `${DISCORD_BASE_URL}/channels/:channelId/messages`,
        async ({ request }) => {
          const body = (await request.json()) as { content: string };
          expect(body.content).toBe("TestUser: Hello");
          return HttpResponse.json({ id: "message-123" });
        },
      ),
    );

    const messageId = await postChannelMessage("Hello", "TestUser" as Username);

    expect(messageId).toBe("message-123");
  });

  it("should include message_reference when replyToMessageId is provided", async () => {
    server.use(
      http.post(
        `${DISCORD_BASE_URL}/channels/:channelId/messages`,
        async ({ request }) => {
          const body = (await request.json()) as {
            content: string;
            message_reference?: { message_id: string };
          };
          expect(body.content).toBe("simon-bot: This is a reply");
          expect(body.message_reference).toEqual({
            message_id: "original-123",
          });
          return HttpResponse.json({ id: "reply-456" });
        },
      ),
    );

    const messageId = await postChannelMessage(
      "This is a reply",
      "simon-bot" as Username,
      "original-123",
    );

    expect(messageId).toBe("reply-456");
  });

  it("should not include message_reference when replyToMessageId is undefined", async () => {
    server.use(
      http.post(
        `${DISCORD_BASE_URL}/channels/:channelId/messages`,
        async ({ request }) => {
          const body = (await request.json()) as {
            content: string;
            message_reference?: { message_id: string };
          };
          expect(body.message_reference).toBeUndefined();
          return HttpResponse.json({ id: "msg-789" });
        },
      ),
    );

    await postChannelMessage("No reply", "TestUser" as Username);
  });

  it.each([
    { status: 401, statusText: "Unauthorized" },
    { status: 403, statusText: "Forbidden" },
    { status: 500, statusText: "Internal Server Error" },
  ])("should handle HTTP $status error", async ({ status, statusText }) => {
    vi.spyOn(log, "error").mockImplementation(() => {});

    server.use(
      http.post(
        `${DISCORD_BASE_URL}/channels/:channelId/messages`,
        () => new HttpResponse(JSON.stringify({}), { status, statusText }),
      ),
    );

    await expect(
      postChannelMessage("Hello", "TestUser" as Username),
    ).rejects.toThrow(`Discord API error: ${status} ${statusText}`);
  });
});

describe("rate limiting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    _resetRateLimitState();
  });

  it("should retry after 429 and succeed", async () => {
    const logWarnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    let attempts = 0;

    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () => {
        attempts++;
        if (attempts <= 2) {
          return HttpResponse.json(
            { message: "Rate limited", retry_after: 1, global: false },
            { status: 429 },
          );
        }
        return HttpResponse.json([]);
      }),
    );

    const promise = getChannelMessages();

    await vi.advanceTimersByTimeAsync(2000);

    await promise;

    expect(attempts).toBe(3);
    expect(logWarnSpy).toHaveBeenCalledTimes(2);
  });

  it("should throw when elapsed + retry_after exceeds timeout", async () => {
    const logErrorSpy = vi.spyOn(log, "error").mockImplementation(() => {});

    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json(
          { message: "Rate limited", retry_after: 35, global: true },
          { status: 429 },
        ),
      ),
    );

    await expect(getChannelMessages()).rejects.toThrow(
      "Discord rate limit exceeded",
    );

    expect(logErrorSpy).toHaveBeenCalledWith(
      {
        endpoint: expect.any(String),
        elapsedMs: 0,
        retryAfterMs: 35000,
        global: true,
        retries: 1,
      },
      "Discord rate limit exceeded max wait time",
    );
  });

  it("should use 1 second fallback when response lacks retry_after", async () => {
    const logWarnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    let attempts = 0;

    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () => {
        attempts++;
        if (attempts === 1) {
          return HttpResponse.json({ invalid: "response" }, { status: 429 });
        }
        return HttpResponse.json([]);
      }),
    );

    const promise = getChannelMessages();

    await vi.advanceTimersByTimeAsync(1000);

    await promise;

    expect(attempts).toBe(2);
    expect(logWarnSpy).toHaveBeenCalledWith(
      {
        endpoint: expect.any(String),
        retryAfterMs: 1000,
        global: false,
        retries: 1,
      },
      "Discord rate limited, retrying",
    );
  });

  it("should account for elapsed time in timeout calculation", async () => {
    const logWarnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    const logErrorSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    let attempts = 0;

    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () => {
        attempts++;
        if (attempts === 1) {
          return HttpResponse.json(
            { message: "Rate limited", retry_after: 15, global: false },
            { status: 429 },
          );
        }
        return HttpResponse.json(
          { message: "Rate limited", retry_after: 16, global: false },
          { status: 429 },
        );
      }),
    );

    const promise = getChannelMessages();
    // Set up rejection expectation before advancing time to avoid unhandled rejection
    const assertion = expect(promise).rejects.toThrow(
      "Discord rate limit exceeded",
    );

    await vi.advanceTimersByTimeAsync(15000);
    await assertion;

    expect(attempts).toBe(2);
    expect(logWarnSpy).toHaveBeenCalledWith(
      {
        endpoint: expect.any(String),
        retryAfterMs: 15000,
        global: false,
        retries: 1,
      },
      "Discord rate limited, retrying",
    );
    expect(logErrorSpy).toHaveBeenCalledWith(
      {
        endpoint: expect.any(String),
        elapsedMs: 15000,
        retryAfterMs: 16000,
        global: false,
        retries: 2,
      },
      "Discord rate limit exceeded max wait time",
    );
  });

  it("should throw when max retries exceeded", async () => {
    const logWarnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    const logErrorSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    let attempts = 0;

    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () => {
        attempts++;
        return HttpResponse.json(
          { message: "Rate limited", retry_after: 1, global: false },
          { status: 429 },
        );
      }),
    );

    const promise = getChannelMessages();
    const assertion = expect(promise).rejects.toThrow(
      "Discord rate limit exceeded",
    );

    await vi.advanceTimersByTimeAsync(10000);
    await assertion;

    // 1 initial + 5 retries = 6 total attempts
    expect(attempts).toBe(6);
    expect(logWarnSpy).toHaveBeenCalledTimes(5);
    expect(logErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ retries: 6 }),
      "Discord rate limit exceeded max wait time",
    );
  });

  it("should share rate limit state across concurrent requests", async () => {
    vi.spyOn(log, "warn").mockImplementation(() => {});
    let fetchCount = 0;

    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () => {
        fetchCount++;
        if (fetchCount === 1) {
          return HttpResponse.json(
            { message: "Rate limited", retry_after: 2, global: false },
            { status: 429 },
          );
        }
        return HttpResponse.json([]);
      }),
    );

    // First request gets 429 and sets the shared gate
    const promise1 = getChannelMessages();
    await vi.advanceTimersByTimeAsync(0);

    // Second request arrives while rate limit gate is active
    const promise2 = getChannelMessages();

    // Advance past the 2-second rate limit window
    await vi.advanceTimersByTimeAsync(2000);

    await Promise.all([promise1, promise2]);

    // Without shared state: 4 fetches (both hit 429 independently, both retry)
    // With shared state: 3 fetches (first gets 429, second waits on gate, both succeed after delay)
    expect(fetchCount).toBe(3);
  });

  it("should throw when shared gate wait exceeds timeout", async () => {
    const logErrorSpy = vi.spyOn(log, "error").mockImplementation(() => {});

    // Directly set a gate 31 seconds in the future — exceeds RATE_LIMIT_TIMEOUT_MS (30s)
    const endpoint = "channels/test-discord-channel-id/messages";
    _setRateLimitGate(endpoint, Date.now() + 31_000);

    // A fresh request checks the gate: waitMs=31000, elapsedMs≈0, 0+31000 > 30000 → throws
    await expect(getChannelMessages()).rejects.toThrow(
      "Discord rate limit exceeded",
    );

    expect(logErrorSpy).toHaveBeenCalledWith(
      { endpoint, elapsedMs: expect.any(Number), waitMs: 31_000, retries: 0 },
      "Discord rate limit exceeded max wait time",
    );
  });

  it("should include retry count in log messages", async () => {
    const logWarnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    let attempts = 0;

    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () => {
        attempts++;
        if (attempts <= 3) {
          return HttpResponse.json(
            { message: "Rate limited", retry_after: 1, global: false },
            { status: 429 },
          );
        }
        return HttpResponse.json([]);
      }),
    );

    const promise = getChannelMessages();
    await vi.advanceTimersByTimeAsync(3000);
    await promise;

    expect(logWarnSpy).toHaveBeenCalledTimes(3);
    expect(logWarnSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ retries: 1 }),
      "Discord rate limited, retrying",
    );
    expect(logWarnSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ retries: 2 }),
      "Discord rate limited, retrying",
    );
    expect(logWarnSpy).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ retries: 3 }),
      "Discord rate limited, retrying",
    );
  });
});
