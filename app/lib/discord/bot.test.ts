// app/lib/discord/bot.test.ts
// @vitest-environment node

import type { Redis } from "@upstash/redis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMessage as createAnthropicMessage } from "@/lib/anthropic";
import { log } from "@/lib/log";

import { getMessageChain, postChannelMessage } from "./api";
import { handleMessage } from "./bot";
import type { DiscordMessage } from "./schemas";

vi.mock(import("server-only"), () => ({}));

const setMock = vi.fn();
vi.mock(import("@/lib/redis"), () => ({
  getRedis: () => ({ set: setMock }) as unknown as Redis,
}));

vi.mock(import("./api"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getMessageChain: vi.fn(), postChannelMessage: vi.fn() };
});

vi.mock(import("@/lib/anthropic"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createMessage: vi.fn() };
});

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
    vi.spyOn(log, "info").mockImplementation(() => {});
    setMock.mockResolvedValue("OK");

    vi.mocked(getMessageChain).mockResolvedValue([
      { id: "msg-1", type: 0, username: "User1", content: "hey simon-bot!" },
    ]);

    async function* mockResponse() {
      yield "hello there!";
    }
    vi.mocked(createAnthropicMessage).mockReturnValue(mockResponse());
    vi.mocked(postChannelMessage).mockResolvedValue("response-1");

    await handleMessage(createMessage({ content: "User1: hey simon-bot!" }));

    expect(postChannelMessage).toHaveBeenCalledWith(
      "hello there!",
      "simon-bot",
      "msg-1",
    );
  });

  it("should not respond when bot is not mentioned", async () => {
    setMock.mockResolvedValue("OK");

    vi.mocked(getMessageChain).mockResolvedValue([
      { id: "msg-1", type: 0, username: "User1", content: "hello world" },
    ]);

    await handleMessage(createMessage({ content: "User1: hello world" }));

    expect(postChannelMessage).not.toHaveBeenCalled();
  });

  it("should respond when bot is mentioned in parent message", async () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
    setMock.mockResolvedValue("OK");

    vi.mocked(getMessageChain).mockResolvedValue([
      {
        id: "msg-1",
        type: 0,
        username: "User1",
        content: "hey simon-bot help",
      },
      { id: "msg-2", type: 19, username: "User2", content: "thanks!" },
    ]);

    async function* mockResponse() {
      yield "you're welcome!";
    }
    vi.mocked(createAnthropicMessage).mockReturnValue(mockResponse());
    vi.mocked(postChannelMessage).mockResolvedValue("response-1");

    await handleMessage(
      createMessage({ type: 19, id: "msg-2", content: "User2: thanks!" }),
    );

    expect(postChannelMessage).toHaveBeenCalledWith(
      "you're welcome!",
      "simon-bot",
      "msg-2",
    );
  });

  it("should skip if already seen (dedup)", async () => {
    setMock.mockResolvedValue(null); // null = key already exists

    await handleMessage(createMessage({ content: "User1: hey simon-bot" }));

    expect(getMessageChain).not.toHaveBeenCalled();
  });

  it("should ignore non-standard message types", async () => {
    await handleMessage(
      createMessage({
        type: 7, // guild member join
        content: "User1: hey simon-bot!",
      }),
    );

    // Should exit early before dedup check
    expect(setMock).not.toHaveBeenCalled();
  });

  it("should skip bot's own messages", async () => {
    await handleMessage(createMessage({ content: "simon-bot: hello there!" }));

    // Should exit early before dedup check
    expect(setMock).not.toHaveBeenCalled();
  });

  it("should log error and not post on failure", async () => {
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    setMock.mockResolvedValue("OK");

    vi.mocked(getMessageChain).mockRejectedValue(new Error("API error"));

    await handleMessage(createMessage({ content: "User1: hey simon-bot" }));

    expect(errorSpy).toHaveBeenCalled();
    expect(postChannelMessage).not.toHaveBeenCalled();
  });
});
