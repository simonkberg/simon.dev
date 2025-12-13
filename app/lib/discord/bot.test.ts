// app/lib/discord/bot.test.ts
// @vitest-environment node

import type { Redis } from "@upstash/redis";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { server } from "@/mocks/node";

import { handleMessage } from "./bot";
import type { DiscordMessage } from "./schemas";

const setMock = vi.fn();

vi.mock(import("server-only"), () => ({}));
vi.mock(import("@/lib/redis"), () => ({
  getRedis: () => ({ set: setMock }) as unknown as Redis,
}));
vi.mock(import("@/lib/log"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    log: {
      ...actual.log,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
});

const DISCORD_BASE_URL = "https://discord.com/api/v10";
const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1/messages";

function createMessage(
  overrides: Partial<DiscordMessage> = {},
): DiscordMessage {
  return {
    type: 0,
    id: "msg-1",
    channel_id: "test-channel",
    author: { id: "user1" },
    content: "User1: hello",
    edited_timestamp: null,
    ...overrides,
  };
}

describe("handleMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should respond when bot is mentioned in the message", async () => {
    setMock.mockResolvedValue("OK");
    let postCalled = false;

    server.use(
      // getMessageChain fetches the message
      http.get(
        `${DISCORD_BASE_URL}/channels/:channelId/messages/:messageId`,
        () =>
          HttpResponse.json({
            type: 0,
            id: "msg-1",
            author: { id: "user1" },
            content: "User1: hey simon-bot!",
            edited_timestamp: null,
          }),
      ),
      // Anthropic response
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({
          content: [{ type: "text", text: "hello there!" }],
          stop_reason: "end_turn",
        }),
      ),
      // Post response
      http.post(
        `${DISCORD_BASE_URL}/channels/:channelId/messages`,
        async ({ request }) => {
          const body = (await request.json()) as { content: string };
          expect(body.content).toBe("simon-bot: hello there!");
          postCalled = true;
          return HttpResponse.json({ id: "response-1" });
        },
      ),
    );

    await handleMessage(createMessage({ content: "User1: hey simon-bot!" }));

    expect(postCalled).toBe(true);
  });

  it("should not respond when bot is not mentioned", async () => {
    setMock.mockResolvedValue("OK");
    let postCalled = false;

    server.use(
      http.get(
        `${DISCORD_BASE_URL}/channels/:channelId/messages/:messageId`,
        () =>
          HttpResponse.json({
            type: 0,
            id: "msg-1",
            author: { id: "user1" },
            content: "User1: hello world",
            edited_timestamp: null,
          }),
      ),
      http.post(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () => {
        postCalled = true;
        return HttpResponse.json({ id: "x" });
      }),
    );

    await handleMessage(createMessage({ content: "User1: hello world" }));

    expect(postCalled).toBe(false);
  });

  it("should respond when bot is mentioned in parent message", async () => {
    setMock.mockResolvedValue("OK");
    let postCalled = false;

    server.use(
      http.get(
        `${DISCORD_BASE_URL}/channels/:channelId/messages/:messageId`,
        ({ params }) => {
          const id = params["messageId"];
          if (id === "msg-2") {
            return HttpResponse.json({
              type: 19,
              id: "msg-2",
              author: { id: "user2" },
              content: "User2: thanks!",
              edited_timestamp: null,
              message_reference: { message_id: "msg-1" },
            });
          }
          return HttpResponse.json({
            type: 0,
            id: "msg-1",
            author: { id: "user1" },
            content: "User1: hey simon-bot help",
            edited_timestamp: null,
          });
        },
      ),
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({
          content: [{ type: "text", text: "you're welcome!" }],
          stop_reason: "end_turn",
        }),
      ),
      http.post(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () => {
        postCalled = true;
        return HttpResponse.json({ id: "x" });
      }),
    );

    await handleMessage(
      createMessage({
        type: 19,
        id: "msg-2",
        author: { id: "user2" },
        content: "User2: thanks!",
        message_reference: { message_id: "msg-1" },
      }),
    );

    expect(postCalled).toBe(true);
  });

  it("should skip if already seen (dedup)", async () => {
    setMock.mockResolvedValue(null); // null = key already exists
    let getMessageCalled = false;

    server.use(
      http.get(
        `${DISCORD_BASE_URL}/channels/:channelId/messages/:messageId`,
        () => {
          getMessageCalled = true;
          return HttpResponse.json({
            type: 0,
            id: "msg-1",
            author: { id: "user1" },
            content: "User1: hey simon-bot",
            edited_timestamp: null,
          });
        },
      ),
    );

    await handleMessage(createMessage({ content: "User1: hey simon-bot" }));

    expect(getMessageCalled).toBe(false);
  });

  it("should ignore non-standard message types", async () => {
    // Type check happens FIRST, before dedup or API calls
    await handleMessage(
      createMessage({
        type: 7, // guild member join
        content: "User1: hey simon-bot!",
      }),
    );

    // setMock should NOT be called - we exit early on type check
    expect(setMock).not.toHaveBeenCalled();
  });

  it("should skip bot's own messages", async () => {
    await handleMessage(createMessage({ content: "simon-bot: hello there!" }));

    // setMock should NOT be called - we exit early on bot message check
    expect(setMock).not.toHaveBeenCalled();
  });

  it("should log error and not post on failure", async () => {
    setMock.mockResolvedValue("OK");

    server.use(
      http.get(
        `${DISCORD_BASE_URL}/channels/:channelId/messages/:messageId`,
        () => HttpResponse.error(),
      ),
    );

    await handleMessage(createMessage({ content: "User1: hey simon-bot" }));

    expect(log.error).toHaveBeenCalled();
  });
});
