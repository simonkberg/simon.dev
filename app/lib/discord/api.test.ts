import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { resetGlobals } from "@/lib/global";
import { log } from "@/lib/log";
import { MIGRATIONS } from "@/lib/migrations";
import type { Username } from "@/lib/session";
import { query } from "@/lib/turso";
import { message, reaction } from "@/mocks/discord";
import { server } from "@/mocks/node";
import { failQuery, sqliteBeforeEach } from "@/mocks/sqlite";

import {
  _setRateLimitGate,
  addBotReaction,
  getChannelMessages,
  getChannelRevision,
  getMessageChain,
  isOwnPost,
  postChannelMessage,
  postedIn,
  removeBotReaction,
  searchChannelMessages,
  sendTyping,
  subscribeToChannel,
} from "./api";
import { connect, subscribe } from "./gateway";
import type { DiscordMessage } from "./schemas";

vi.mock(import("@/lib/turso"), () => ({ query: vi.fn() }));

vi.mock(import("./gateway"), () => ({
  connect: vi.fn(async () => {}),
  subscribe: vi.fn(async () => () => {}),
  getBotUserId: () => "bot-user-id",
}));

const sqlite = sqliteBeforeEach(query, MIGRATIONS);

const DISCORD_BASE_URL = "https://discord.com/api/v10";
const MESSAGES_URL = `${DISCORD_BASE_URL}/channels/:channelId/messages`;
const MESSAGE_URL = `${MESSAGES_URL}/:messageId`;
const REACTIONS_URL = `${MESSAGE_URL}/reactions/:emoji`;
const BOT_REACTION_URL = `${REACTIONS_URL}/@me`;
const BOT_REACTION_ROUTE =
  "/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me";
const MEMBER_URL = `${DISCORD_BASE_URL}/guilds/:guildId/members/:userId`;
const SEARCH_URL = `${DISCORD_BASE_URL}/guilds/:guildId/messages/search`;

function member(username: string, nick: string | null = null) {
  return HttpResponse.json({ user: { username, global_name: null }, nick });
}

function goneMember() {
  return HttpResponse.json(
    { message: "Unknown Member", code: 10007 },
    { status: 404 },
  );
}

function serverError() {
  return HttpResponse.json({ message: "oops", code: 0 }, { status: 500 });
}

function rateLimited(retryAfter: number, global = false) {
  return HttpResponse.json(
    { message: "Rate limited", retry_after: retryAfter, global },
    { status: 429 },
  );
}

function htmlRateLimited(headers?: Record<string, string>) {
  return HttpResponse.html("<html>Too Many Requests</html>", {
    status: 429,
    headers,
  });
}

const noContent = () => new HttpResponse(null, { status: 204 });
const emptyList = () => HttpResponse.json([]);

// Answers the first `times` requests with `first`, and every later one with `rest`.
function onceThen(first: () => Response, rest: () => Response, times = 1) {
  const handler = vi.fn(() =>
    handler.mock.calls.length <= times ? first() : rest(),
  );
  return handler;
}

function history(...messages: DiscordMessage[]) {
  return http.get(MESSAGES_URL, () => HttpResponse.json(messages));
}

function byId(...messages: DiscordMessage[]) {
  return http.get(MESSAGE_URL, ({ params }) =>
    HttpResponse.json(messages.find((m) => m.id === params["messageId"])),
  );
}

// Posted by the bot for a site visitor, so the author is the content's prefix and needs no lookup.
function post(
  id: string,
  overrides: Partial<DiscordMessage> = {},
): DiscordMessage {
  return message(id, { author: { id: "user1", bot: true }, ...overrides });
}

function reply(id: string, parent: string, content: string) {
  return post(id, {
    type: 19,
    content,
    message_reference: { message_id: parent },
  });
}

describe("getChannelMessages", () => {
  it("should fetch and parse messages successfully", async () => {
    server.use(history(post("1", { content: "TestUser: Hello world" })));

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

  it("should parse prefixed message with empty content", async () => {
    server.use(history(post("1", { content: "TestUser:" })));

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([
      { id: "1", content: "", user: { name: "TestUser" } },
    ]);
  });

  it("should leave markdown in content untouched", async () => {
    server.use(
      history(post("1", { content: "TestUser: **Bold** and *italic*" })),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([{ content: "**Bold** and *italic*" }]);
  });

  it("should name a non-bot author from the guild member and keep their content whole", async () => {
    server.use(
      history(
        post("1", {
          author: { id: "human-user" },
          content: "the source is here: https://github.com/example/repo",
        }),
      ),
      http.get(MEMBER_URL, ({ params }) =>
        params["userId"] === "human-user"
          ? member("simon", "Simon")
          : goneMember(),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([
      {
        id: "1",
        content: "the source is here: https://github.com/example/repo",
        user: { name: "Simon" },
      },
    ]);
  });

  it("should handle edited messages", async () => {
    server.use(
      history(post("1", { edited_timestamp: "2024-01-01T00:00:00Z" })),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([{ edited: true }]);
  });

  it("should count Discord reactions other than the bot's own mirror", async () => {
    server.use(
      history(
        post("1", {
          reactions: [
            reaction("👍", 3, true),
            reaction("🎉", 1, true),
            reaction("😂", 2),
            { count: 1, me: false, emoji: { id: "42", name: "custom" } },
          ],
        }),
      ),
      http.get(REACTIONS_URL, ({ params }) =>
        HttpResponse.json(
          params["emoji"] === "👍"
            ? [
                { id: "reactor-1" },
                { id: "reactor-2" },
                { id: "bot", bot: true },
              ]
            : [{ id: "reactor-1" }, { id: "reactor-2" }],
        ),
      ),
      http.get(MEMBER_URL, ({ params }) =>
        member(
          String(params["userId"]),
          params["userId"] === "reactor-1" ? "simon" : null,
        ),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages[0]?.reactions).toEqual([
      { emoji: "👍", count: 2, users: ["simon", "reactor-2"] },
      { emoji: "😂", count: 2, users: ["simon", "reactor-2"] },
    ]);
  });

  it("should page through every Discord reactor", async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}` }));
    server.use(
      history(post("many-reactors", { reactions: [reaction("😂", 101)] })),
      http.get(REACTIONS_URL, ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.get("after") === "r99"
            ? [{ id: "r100" }]
            : page,
        ),
      ),
      http.get(MEMBER_URL, ({ params }) => member(String(params["userId"]))),
    );

    const messages = await getChannelMessages();

    expect(messages[0]?.reactions?.[0]?.users).toHaveLength(101);
    expect(messages[0]?.reactions?.[0]?.users.at(-1)).toBe("r100");
  });

  it("should skip Discord reactors who left the server", async () => {
    server.use(
      history(post("reactors-left", { reactions: [reaction("😂", 2)] })),
      http.get(REACTIONS_URL, () =>
        HttpResponse.json([{ id: "reactor-stays" }, { id: "reactor-left" }]),
      ),
      http.get(MEMBER_URL, ({ params }) =>
        params["userId"] === "reactor-left" ? goneMember() : member("stays"),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages[0]?.reactions).toEqual([
      { emoji: "😂", count: 2, users: ["stays"] },
    ]);
  });

  it("should keep the reactors it could name when one lookup fails", async () => {
    server.use(
      history(post("reactor-fails", { reactions: [reaction("😂", 2)] })),
      http.get(REACTIONS_URL, () =>
        HttpResponse.json([{ id: "reactor-ok" }, { id: "reactor-busy" }]),
      ),
      http.get(MEMBER_URL, ({ params }) =>
        params["userId"] === "reactor-busy" ? serverError() : member("ok"),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages[0]?.reactions).toEqual([
      { emoji: "😂", count: 2, users: ["ok"] },
    ]);
  });

  it("should name an author who left the server by their Discord name, or else their id", async () => {
    server.use(
      history(
        post("1", {
          author: { id: "author-left", username: "left", global_name: null },
        }),
        post("2", { author: { id: "nameless" } }),
      ),
      http.get(MEMBER_URL, goneMember),
    );

    const messages = await getChannelMessages();

    expect(messages.map((m) => m.user.name)).toEqual(["left", "nameless"]);
  });

  it("should fail when an author's name fails to load", async () => {
    server.use(
      history(
        post("1", {
          author: { id: "busy", username: "busy", global_name: null },
          content: "hi",
        }),
      ),
      http.get(MEMBER_URL, serverError),
    );

    await expect(getChannelMessages()).rejects.toThrow(
      "Discord API error: 500",
    );
  });

  it("should still serve history when the gateway can't be subscribed to", async () => {
    vi.mocked(subscribe).mockRejectedValueOnce(new Error("fatal"));
    server.use(history(post("1")));

    expect(await getChannelMessages()).toHaveLength(1);
    expect(log.error).toHaveBeenCalledWith(
      { err: new Error("fatal") },
      "Channel store failed to subscribe to the gateway",
    );
  });

  it("should still count Discord reactions when their names fail to load", async () => {
    server.use(
      history(post("1", { reactions: [reaction("😂")] })),
      http.get(REACTIONS_URL, () => new HttpResponse(null, { status: 500 })),
    );

    const messages = await getChannelMessages();

    expect(messages[0]?.reactions).toEqual([
      { emoji: "😂", count: 1, users: [] },
    ]);
    expect(log.warn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ messageId: "1", emoji: "😂" }),
      "Failed to load reactors",
    );
  });

  it("should handle replies as nested messages with multiple levels", async () => {
    server.use(
      history(
        post("1", { content: "User1: Parent message" }),
        reply("2", "1", "User2: First reply"),
        reply("3", "2", "User3: Reply to reply"),
        reply("4", "1", "User4: Another top-level reply"),
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

  it("should not resolve replies whose parent is outside the window", async () => {
    const memberLookups = vi.fn(() => member("user1"));
    const reactorLookups = vi.fn(emptyList);
    server.use(
      history(
        post("1", {
          author: { id: "user1" },
          content: "Orphaned reply",
          message_reference: { message_id: "999" },
          reactions: [reaction("😂")],
        }),
      ),
      http.get(MEMBER_URL, memberLookups),
      http.get(REACTIONS_URL, reactorLookups),
    );

    expect(await getChannelMessages()).toEqual([]);
    expect(memberLookups).not.toHaveBeenCalled();
    expect(reactorLookups).not.toHaveBeenCalled();
  });

  it("should show a forward as a message of its own", async () => {
    server.use(
      history(
        post("1"),
        post("2", { message_reference: { type: 1, message_id: "1" } }),
      ),
    );

    expect(await getChannelMessages()).toMatchObject([
      { id: "1", replies: [] },
      { id: "2", replies: [] },
    ]);
  });

  it("should show what a forward forwards", async () => {
    const forward = {
      content: "",
      message_reference: { type: 1, message_id: "1" },
    };
    const forwarder = { id: "user2", username: "forwarder" };
    server.use(
      history(
        post("2", {
          ...forward,
          author: forwarder,
          message_snapshots: [{ message: { content: "Forwarded text" } }],
        }),
        post("3", {
          ...forward,
          author: forwarder,
          message_snapshots: [{ message: {} }],
        }),
        post("4", {
          ...forward,
          message_snapshots: [{ message: { content: "Name: Hi" } }],
        }),
      ),
      http.get(MEMBER_URL, () => member("forwarder")),
    );

    expect(await getChannelMessages()).toMatchObject([
      { id: "2", content: "Forwarded text" },
      { id: "3", content: "" },
      { id: "4", content: "Name: Hi" },
    ]);
  });

  it("should sort messages by ID", async () => {
    server.use(history(post("3"), post("1"), post("2")));

    const messages = await getChannelMessages();

    expect(messages.map((m) => m.id)).toEqual(["1", "2", "3"]);
  });

  it("should configure fetch with 5 second timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    server.use(history());

    await getChannelMessages();

    expect(timeoutSpy).toHaveBeenCalledWith(5000);
  });

  it("should throw Discord's status on an HTTP error", async () => {
    server.use(
      http.get(
        MESSAGES_URL,
        () =>
          new HttpResponse(JSON.stringify({}), {
            status: 403,
            statusText: "Forbidden",
          }),
      ),
    );

    await expect(getChannelMessages()).rejects.toThrow(
      "Discord API error: 403 Forbidden",
    );
  });

  it("should handle invalid response schema", async () => {
    server.use(
      http.get(MESSAGES_URL, () => HttpResponse.json({ invalid: "data" })),
    );

    await expect(getChannelMessages()).rejects.toBeInstanceOf(z.ZodError);
  });
});

describe("subscribeToChannel", () => {
  it("should call back, with a new revision, once the store has seeded", async () => {
    server.use(history());
    const revision = getChannelRevision();
    const callback = vi.fn();

    await subscribeToChannel(callback);
    await getChannelMessages();
    expect(callback).toHaveBeenCalledOnce();
    expect(getChannelRevision()).not.toBe(revision);
  });

  it("should stop listening when the gateway can't connect", async () => {
    vi.mocked(connect).mockRejectedValueOnce(new Error("fatal"));
    const callback = vi.fn();

    await expect(subscribeToChannel(callback)).rejects.toThrow("fatal");
    server.use(history());
    await getChannelMessages();

    expect(callback).not.toHaveBeenCalled();
  });
});

describe("getMessageChain", () => {
  it("should return single message when no parent", async () => {
    server.use(byId(post("single-1", { content: "User1: Hello" })));

    const chain = await getMessageChain("single-1");

    expect(chain).toHaveLength(1);
    expect(chain[0]).toMatchObject({ id: "single-1", content: "Hello" });
  });

  it("should read messages in the window from the store", async () => {
    const single = vi.fn(serverError);
    server.use(
      history(reply("stored-2", "stored-1", "User2: Second"), post("stored-1")),
      http.get(MESSAGE_URL, single),
    );
    await getChannelMessages();

    const chain = await getMessageChain("stored-2");

    expect(chain.map(({ id }) => id)).toEqual(["stored-1", "stored-2"]);
    expect(single).not.toHaveBeenCalled();
  });

  it("should walk up the chain to root (ordered root-first)", async () => {
    server.use(
      byId(
        reply("chain-3", "chain-2", "User3: Third"),
        reply("chain-2", "chain-1", "User2: Second"),
        post("chain-1", { content: "User1: First" }),
      ),
    );

    const chain = await getMessageChain("chain-3");

    expect(chain.map((m) => m.id)).toEqual(["chain-1", "chain-2", "chain-3"]);
    expect(chain.map((m) => m.username)).toEqual(["User1", "User2", "User3"]);
    expect(chain.map((m) => m.content)).toEqual(["First", "Second", "Third"]);
  });

  it("should stop at a forward", async () => {
    server.use(
      history(
        post("2", { message_reference: { type: 1, message_id: "1" } }),
        post("1"),
      ),
    );
    await getChannelMessages();

    const chain = await getMessageChain("2");

    expect(chain.map((m) => m.id)).toEqual(["2"]);
  });

  it("should stop on circular reference", async () => {
    server.use(
      byId(
        reply("circular-2", "circular-1", "User2: Reply"),
        reply("circular-1", "circular-2", "User1: First"),
      ),
    );

    const chain = await getMessageChain("circular-2");

    expect(chain.map((m) => m.id)).toEqual(["circular-1", "circular-2"]);
  });

  it("should limit chain depth to 50 messages", async () => {
    let callCount = 0;
    server.use(
      http.get(MESSAGE_URL, ({ params }) => {
        callCount++;
        const id = Number(params["messageId"]);
        return HttpResponse.json(
          reply(String(id), String(id - 1), "User1: Hi"),
        );
      }),
    );

    const chain = await getMessageChain("100");

    expect(chain).toHaveLength(50);
    expect(callCount).toBe(50);
  });
});

describe("postChannelMessage", () => {
  it("should post the message with its author's prefix and shortcodes as emoji, and return Discord's id", async () => {
    const requests = vi.fn();
    server.use(
      http.post(MESSAGES_URL, async ({ request }) => {
        requests(await request.json(), request.headers.get("Authorization"));
        return HttpResponse.json({ id: "message-123" });
      }),
    );

    const messageId = await postChannelMessage(
      "Hello :book:",
      "TestUser" as Username,
    );

    expect(messageId).toBe("message-123");
    expect(requests).toHaveBeenCalledExactlyOnceWith(
      { content: "TestUser: Hello 📖", nonce: expect.any(String) },
      "Bot test-discord-bot-token",
    );
  });

  it("should include message_reference when replyToMessageId is provided", async () => {
    const requests = vi.fn();
    server.use(
      http.post(MESSAGES_URL, async ({ request }) => {
        requests(await request.json());
        return HttpResponse.json({ id: "reply-456" });
      }),
    );

    const messageId = await postChannelMessage(
      "This is a reply",
      "simon-bot" as Username,
      "original-123",
    );

    expect(messageId).toBe("reply-456");
    expect(requests).toHaveBeenCalledExactlyOnceWith({
      content: "simon-bot: This is a reply",
      nonce: expect.any(String),
      message_reference: {
        message_id: "original-123",
        fail_if_not_exists: false,
      },
    });
  });
});

describe("isOwnPost", () => {
  async function postedNonce(): Promise<string> {
    let nonce = "";
    server.use(
      http.post(MESSAGES_URL, async ({ request }) => {
        ({ nonce } = (await request.json()) as { nonce: string });
        return HttpResponse.json({ id: "message-123" });
      }),
    );
    await postChannelMessage("Hello", "TestUser" as Username);
    return nonce;
  }

  it("should recognise only messages carrying this process's post nonce", async () => {
    const nonce = await postedNonce();

    expect(isOwnPost(message("message-123", { nonce }))).toBe(true);
    expect(isOwnPost(message("message-456", { nonce: "elsewhere" }))).toBe(
      false,
    );
  });

  it("should share the nonce between processes of one Railway environment", async () => {
    vi.stubEnv(
      "RAILWAY_ENVIRONMENT_ID",
      "aaf0d6d1-c4a2-4826-a849-5c35f7cd334c",
    );
    const nonce = await postedNonce();
    resetGlobals();

    expect(isOwnPost(message("message-123", { nonce }))).toBe(true);
    expect(nonce).toHaveLength(25);
  });
});

describe("postedIn", () => {
  const chain = (...ids: string[]) =>
    ids.map((id) => ({
      id,
      type: 0,
      username: "u",
      content: "",
      reactions: [],
    }));

  beforeEach(() => {
    server.use(
      http.post(MESSAGES_URL, () => HttpResponse.json({ id: "message-123" })),
    );
  });

  it("should find only this environment's posts in a chain on a shared channel", async () => {
    await postChannelMessage("Hello", "TestUser" as Username);

    expect(await postedIn(chain("message-123", "message-456"))).toBe(true);
    expect(await postedIn(chain("message-456"))).toBe(false);
  });

  it("should still return the posted id when recording it fails", async () => {
    vi.mocked(query).mockImplementation(failQuery(sqlite(), "INSERT"));

    expect(await postChannelMessage("Hello", "TestUser" as Username)).toBe(
      "message-123",
    );
    expect(log.warn).toHaveBeenCalledExactlyOnceWith(
      { err: expect.any(Error), messageId: "message-123" },
      "Failed to record own post",
    );
  });

  it("should answer every chain in production, which has its own channel", async () => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");

    await postChannelMessage("Hello", "TestUser" as Username);

    expect(await postedIn(chain("message-456"))).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("bot reactions", () => {
  it.each([
    { name: "add", method: http.put, call: addBotReaction, emoji: "👍🏽" },
    {
      name: "remove",
      method: http.delete,
      call: removeBotReaction,
      emoji: "🎉",
    },
  ])(
    "should $name the bot's reaction with the emoji encoded",
    async ({ method, call, emoji }) => {
      const onRequest = vi.fn();
      server.use(
        method(BOT_REACTION_URL, ({ params }) => {
          onRequest(params);
          return noContent();
        }),
      );

      await call("123", emoji);

      expect(onRequest).toHaveBeenCalledWith({
        channelId: "test-discord-channel-id",
        messageId: "123",
        emoji,
      });
    },
  );

  it("should carry Discord's error code", async () => {
    server.use(
      http.put(BOT_REACTION_URL, () =>
        HttpResponse.json(
          { message: "Maximum number of reactions reached (20)", code: 30010 },
          { status: 400 },
        ),
      ),
    );

    await expect(addBotReaction("123", "👍")).rejects.toMatchObject({
      name: "DiscordApiError",
      code: 30010,
    });
  });
});

describe("sendTyping", () => {
  it("should show the bot typing in the site's channel", async () => {
    const onRequest = vi.fn();
    server.use(
      http.post(
        `${DISCORD_BASE_URL}/channels/:channelId/typing`,
        ({ params }) => {
          onRequest(params);
          return noContent();
        },
      ),
    );

    await sendTyping();

    expect(onRequest).toHaveBeenCalledWith({
      channelId: "test-discord-channel-id",
    });
  });
});

describe("response bodies", () => {
  it("should accept a success with an empty body", async () => {
    server.use(
      http.put(BOT_REACTION_URL, () => new HttpResponse(null, { status: 200 })),
    );

    await expect(addBotReaction("1", "👍")).resolves.toBeUndefined();
  });

  it.each([
    {
      status: 502,
      statusText: "Bad Gateway",
      error: "502 Bad Gateway",
      logged: "Discord API call failed",
    },
    {
      status: 200,
      statusText: "OK",
      error: "200 body isn't JSON",
      logged: "Discord API body isn't JSON",
    },
  ])(
    "should report the status of a $status whose body isn't JSON",
    async ({ status, statusText, error, logged }) => {
      server.use(
        http.put(BOT_REACTION_URL, () =>
          HttpResponse.html("<html>Not JSON</html>", { status, statusText }),
        ),
      );

      await expect(addBotReaction("1", "👍")).rejects.toMatchObject({
        name: "DiscordApiError",
        message: `Discord API error: ${error}`,
        code: undefined,
      });
      expect(log.error).toHaveBeenCalledWith(
        expect.objectContaining({ status, body: "<html>Not JSON</html>" }),
        logged,
      );
    },
  );

  it("should not mistake a failed body read for a body that isn't JSON", async () => {
    const timeout = new DOMException(
      "The operation timed out.",
      "TimeoutError",
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(timeout);
          },
        }),
        { status: 429 },
      ),
    );

    await expect(getChannelMessages()).rejects.toBe(timeout);
  });
});

describe("rate limiting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  it("should retry after 429s and count the retries in the logs", async () => {
    const requests = onceThen(() => rateLimited(1), emptyList, 3);
    server.use(http.get(MESSAGES_URL, requests));

    const promise = getChannelMessages();
    await vi.advanceTimersByTimeAsync(3000);
    await promise;

    expect(requests).toHaveBeenCalledTimes(4);
    expect(log.warn).toHaveBeenCalledTimes(3);
    for (const retries of [1, 2, 3]) {
      expect(log.warn).toHaveBeenNthCalledWith(
        retries,
        expect.objectContaining({ retries }),
        "Discord rate limited, retrying",
      );
    }
  });

  it("should throw when elapsed + retry_after exceeds timeout", async () => {
    server.use(http.get(MESSAGES_URL, () => rateLimited(35, true)));

    await expect(getChannelMessages()).rejects.toThrow(
      "Discord rate limit exceeded",
    );

    expect(log.error).toHaveBeenCalledWith(
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

  it("should account for elapsed time in timeout calculation", async () => {
    const requests = onceThen(
      () => rateLimited(15),
      () => rateLimited(16),
    );
    server.use(http.get(MESSAGES_URL, requests));

    const promise = getChannelMessages();
    const assertion = expect(promise).rejects.toThrow(
      "Discord rate limit exceeded",
    );

    await vi.advanceTimersByTimeAsync(15000);
    await assertion;

    expect(requests).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledWith(
      {
        endpoint: expect.any(String),
        retryAfterMs: 15000,
        global: false,
        retries: 1,
      },
      "Discord rate limited, retrying",
    );
    expect(log.error).toHaveBeenCalledWith(
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
    const requests = vi.fn(() => rateLimited(1));
    server.use(http.get(MESSAGES_URL, requests));

    const promise = getChannelMessages();
    const assertion = expect(promise).rejects.toThrow(
      "Discord rate limit exceeded",
    );

    await vi.advanceTimersByTimeAsync(10000);
    await assertion;

    // 1 initial + 5 retries = 6 total attempts
    expect(requests).toHaveBeenCalledTimes(6);
    expect(log.warn).toHaveBeenCalledTimes(5);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ retries: 6 }),
      "Discord rate limit exceeded max wait time",
    );
  });

  it.each([
    [
      "another message on the same route",
      () => rateLimited(2),
      () => addBotReaction("2", "🎉"),
      true,
    ],
    [
      "each method on a route separately",
      () => rateLimited(2),
      () => removeBotReaction("2", "🎉"),
      false,
    ],
    [
      "every route after a global 429",
      () => rateLimited(2, true),
      getChannelMessages,
      true,
    ],
    [
      "every route on a 429 whose header says it's global",
      () =>
        htmlRateLimited({ "Retry-After": "2", "X-RateLimit-Global": "true" }),
      getChannelMessages,
      true,
    ],
  ])("should gate %s", async (_, response, secondCall, heldBack) => {
    server.use(
      http.put(BOT_REACTION_URL, onceThen(response, noContent)),
      http.delete(BOT_REACTION_URL, noContent),
      http.get(MESSAGES_URL, emptyList),
    );

    const first = addBotReaction("1", "👍");
    await vi.advanceTimersByTimeAsync(0);
    let settled = false;
    const second = secondCall().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(!heldBack);

    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([first, second]);
  });

  it.each([
    ["retry_after 0", () => rateLimited(0), 1000],
    [
      "a JSON body without retry_after",
      () => HttpResponse.json({ invalid: "response" }, { status: 429 }),
      1000,
    ],
    ["a body that isn't JSON", () => htmlRateLimited(), 1000],
    ["Retry-After 3", () => htmlRateLimited({ "Retry-After": "3" }), 3000],
    [
      "Retry-After as an HTTP-date",
      () =>
        htmlRateLimited({
          "Retry-After": new Date(Date.now() + 3000).toUTCString(),
        }),
      3000,
    ],
    ["Retry-After 0", () => htmlRateLimited({ "Retry-After": "0" }), 1000],
    [
      "an invalid Retry-After",
      () => htmlRateLimited({ "Retry-After": "soon" }),
      1000,
    ],
    [
      "a negative Retry-After",
      () => htmlRateLimited({ "Retry-After": "-5" }),
      1000,
    ],
    [
      "an exponent Retry-After",
      () => htmlRateLimited({ "Retry-After": "1e3" }),
      1000,
    ],
    [
      "a fractional Retry-After",
      () => htmlRateLimited({ "Retry-After": "1.5" }),
      1000,
    ],
    [
      "a malformed date Retry-After",
      () => htmlRateLimited({ "Retry-After": "Sun, 99 Foo 2026 00:00:00 GMT" }),
      1000,
    ],
    [
      "a past date Retry-After",
      () =>
        htmlRateLimited({
          "Retry-After": new Date(Date.now() - 3000).toUTCString(),
        }),
      1000,
    ],
    [
      "an empty Retry-After",
      () => htmlRateLimited({ "Retry-After": "" }),
      1000,
    ],
  ])(
    "should wait the right delay after a 429 with %s",
    async (_, response, retryAfterMs) => {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const requests = onceThen(response, emptyList);
      server.use(http.get(MESSAGES_URL, requests));

      const promise = getChannelMessages();
      await vi.advanceTimersByTimeAsync(retryAfterMs - 1);
      expect(requests).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      await promise;

      expect(requests).toHaveBeenCalledTimes(2);
      expect(log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ retryAfterMs }),
        "Discord rate limited, retrying",
      );
    },
  );

  it("should back off on 429s with no Retry-After", async () => {
    server.use(http.get(MESSAGES_URL, onceThen(htmlRateLimited, emptyList, 3)));

    const promise = getChannelMessages();
    await vi.advanceTimersByTimeAsync(7000);
    await promise;

    for (const [i, retryAfterMs] of [1000, 2000, 4000].entries()) {
      expect(log.warn).toHaveBeenNthCalledWith(
        i + 1,
        expect.objectContaining({ retryAfterMs, global: false }),
        "Discord rate limited, retrying",
      );
    }
  });

  it("should keep a long gate, so callers fail fast instead of re-hitting Discord", async () => {
    const messageRequests = vi.fn(emptyList);
    server.use(
      http.put(BOT_REACTION_URL, () => rateLimited(3600, true)),
      http.get(MESSAGES_URL, messageRequests),
    );

    await expect(addBotReaction("1", "👍")).rejects.toThrow(
      "Discord rate limit exceeded",
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(getChannelMessages()).rejects.toThrow(
      "Discord rate limit exceeded",
    );
    expect(messageRequests).not.toHaveBeenCalled();
  });

  it("should spread out callers on a gate and keep them waiting when it moves", async () => {
    const requests = onceThen(() => rateLimited(5), noContent);
    server.use(http.put(BOT_REACTION_URL, requests));
    _setRateLimitGate("PUT", BOT_REACTION_ROUTE, Date.now() + 1000);

    vi.mocked(Math.random).mockReturnValueOnce(0).mockReturnValueOnce(0.8);
    const first = addBotReaction("1", "👍");
    const second = addBotReaction("2", "🎉");

    await vi.advanceTimersByTimeAsync(1000);
    expect(requests).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(200);
    expect(requests).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all([first, second]);
    expect(requests).toHaveBeenCalledTimes(3);
  });

  it.each([
    { waitMs: 31_000, jitter: 0 },
    { waitMs: 29_900, jitter: 0.8 },
  ])(
    "should fail fast on a $waitMs ms gate with $jitter jitter",
    async ({ waitMs, jitter }) => {
      vi.mocked(Math.random).mockReturnValue(jitter);
      _setRateLimitGate(
        "GET",
        "/channels/{channel.id}/messages",
        Date.now() + waitMs,
      );

      await expect(getChannelMessages()).rejects.toThrow(
        "Discord rate limit exceeded",
      );
      expect(log.error).toHaveBeenCalledWith(
        {
          endpoint: "/channels/test-discord-channel-id/messages",
          elapsedMs: expect.any(Number),
          waitMs,
          retries: 0,
        },
        "Discord rate limit exceeded max wait time",
      );
    },
  );

  it("should give up on a 429 the gate's wait wouldn't fit", async () => {
    server.use(http.get(MESSAGES_URL, () => rateLimited(29.9)));

    await expect(getChannelMessages()).rejects.toThrow(
      "Discord rate limit exceeded",
    );
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ retryAfterMs: 29_900, retries: 1 }),
      "Discord rate limit exceeded max wait time",
    );
  });
});

describe("searchChannelMessages", () => {
  it("should search messages and return hits with context", async () => {
    const onSearch = vi.fn();
    server.use(
      http.get(SEARCH_URL, ({ request }) => {
        onSearch(Object.fromEntries(new URL(request.url).searchParams));
        return HttpResponse.json({
          total_results: 1,
          messages: [
            [
              post("ctx-1", { content: "Alice: before the match" }),
              {
                ...post("hit-1", {
                  content: "Bob: hello everyone",
                  timestamp: "2025-01-01T00:01:00.000000+00:00",
                }),
                hit: true,
              },
              post("ctx-2", {
                author: { id: "user3" },
                content: "after the match",
                timestamp: "2025-01-01T00:02:00.000000+00:00",
              }),
            ],
          ],
        });
      }),
      http.get(MEMBER_URL, ({ params }) =>
        params["userId"] === "user3"
          ? member("charlie", "Charlie")
          : goneMember(),
      ),
    );

    const result = await searchChannelMessages({
      content: "hello",
      limit: 5,
      sort_by: "relevance",
      sort_order: "desc",
    });

    expect(onSearch).toHaveBeenCalledExactlyOnceWith({
      content: "hello",
      channel_id: "test-discord-channel-id",
      limit: "5",
      sort_by: "relevance",
      sort_order: "desc",
    });
    expect(result).toEqual({
      total_results: 1,
      hits: [
        {
          hit: {
            id: "hit-1",
            username: "Bob",
            content: "hello everyone",
            timestamp: "2025-01-01T00:01:00.000000+00:00",
          },
          context: [
            {
              id: "ctx-1",
              username: "Alice",
              content: "before the match",
              timestamp: "2025-01-01T00:00:00.000000+00:00",
            },
            {
              id: "ctx-2",
              username: "Charlie",
              content: "after the match",
              timestamp: "2025-01-01T00:02:00.000000+00:00",
            },
          ],
        },
      ],
    });
  });

  it("should pass only the given params and handle no results", async () => {
    const onSearch = vi.fn();
    server.use(
      http.get(SEARCH_URL, ({ request }) => {
        onSearch(Object.fromEntries(new URL(request.url).searchParams));
        return HttpResponse.json({ total_results: 0, messages: [] });
      }),
    );

    const result = await searchChannelMessages({ content: "nonexistent" });

    expect(result).toEqual({ total_results: 0, hits: [] });
    expect(onSearch).toHaveBeenCalledExactlyOnceWith({
      content: "nonexistent",
      channel_id: "test-discord-channel-id",
    });
  });

  it("should throw when a message group has no hit marker", async () => {
    server.use(
      http.get(SEARCH_URL, () =>
        HttpResponse.json({
          total_results: 1,
          messages: [[post("no-hit-1", { content: "Alice: no hit flag" })]],
        }),
      ),
    );

    await expect(searchChannelMessages({ content: "test" })).rejects.toThrow(
      "Discord search returned a message group with no hit",
    );
  });
});
