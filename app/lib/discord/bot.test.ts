// @vitest-environment node

import type { Redis } from "@upstash/redis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMessage as createAnthropicMessage } from "@/lib/anthropic";
import { log } from "@/lib/log";
import { getProfile } from "@/lib/profile";
import { reflect } from "@/lib/reflection";

import { getMessageChain, postChannelMessage } from "./api";
import { _resetNameCache, handleMessage, startBotSubscription } from "./bot";
import { subscribeToMessages } from "./gateway";
import type { DiscordMessage } from "./schemas";

vi.mock(import("server-only"), () => ({}));

const setMock = vi.fn();
vi.mock(import("@/lib/redis"), () => ({
  getRedis: () => ({ set: setMock }) as unknown as Redis,
}));

vi.mock(import("@/lib/profile"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getProfile: vi.fn() };
});
vi.mock(import("@/lib/reflection"), () => ({ reflect: vi.fn() }));

vi.mock(import("./api"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getMessageChain: vi.fn(), postChannelMessage: vi.fn() };
});

vi.mock(import("@/lib/anthropic"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createMessage: vi.fn() };
});

vi.mock(import("./gateway"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, subscribeToMessages: vi.fn() };
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
    timestamp: "2025-01-01T00:00:00.000000+00:00",
    edited_timestamp: null,
    ...overrides,
  };
}

const blankProfile = { name: "", pronouns: "", system_prompt: "" };

describe("handleMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetNameCache();
    vi.mocked(getProfile).mockResolvedValue(blankProfile);
    vi.mocked(reflect).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should respond when bot is mentioned in the message", async () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
    setMock.mockResolvedValue("OK");

    vi.mocked(getMessageChain).mockResolvedValue([
      {
        id: "msg-1",
        type: 0,
        username: "User1",
        content: "hey simon-bot!",
        fromOwner: false,
      },
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
      {
        id: "msg-1",
        type: 0,
        username: "User1",
        content: "hello world",
        fromOwner: false,
      },
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
        fromOwner: false,
      },
      {
        id: "msg-2",
        type: 19,
        username: "User2",
        content: "thanks!",
        fromOwner: false,
      },
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

  it("should map bot messages to assistant role in conversation", async () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
    setMock.mockResolvedValue("OK");

    vi.mocked(getMessageChain).mockResolvedValue([
      {
        id: "msg-1",
        type: 0,
        username: "User1",
        content: "hey simon-bot!",
        fromOwner: false,
      },
      {
        id: "msg-2",
        type: 19,
        username: "simon-bot",
        content: "hello there!",
        fromOwner: false,
      },
      {
        id: "msg-3",
        type: 19,
        username: "User1",
        content: "thanks!",
        fromOwner: false,
      },
    ]);

    async function* mockResponse() {
      yield "you're welcome!";
    }
    vi.mocked(createAnthropicMessage).mockReturnValue(mockResponse());
    vi.mocked(postChannelMessage).mockResolvedValue("response-1");

    await handleMessage(
      createMessage({ type: 19, id: "msg-3", content: "User1: thanks!" }),
    );

    expect(createAnthropicMessage).toHaveBeenCalledWith([
      {
        role: "user",
        username: "User1",
        content: "hey simon-bot!",
        owner: false,
      },
      {
        role: "assistant",
        username: "simon-bot",
        content: "hello there!",
        owner: false,
      },
      { role: "user", username: "User1", content: "thanks!", owner: false },
    ]);
  });

  it("should flag messages posted from Discord as the owner's", async () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
    setMock.mockResolvedValue("OK");

    vi.mocked(getMessageChain).mockResolvedValue([
      {
        id: "msg-1",
        type: 0,
        username: "Simon",
        content: "hey simon-bot",
        fromOwner: true,
      },
    ]);

    async function* mockResponse() {
      yield "hi boss";
    }
    vi.mocked(createAnthropicMessage).mockReturnValue(mockResponse());
    vi.mocked(postChannelMessage).mockResolvedValue("response-1");

    await handleMessage(
      createMessage({ author: { id: "simon" }, content: "hey simon-bot" }),
    );

    expect(createAnthropicMessage).toHaveBeenCalledWith([
      {
        role: "user",
        username: "Simon",
        content: "hey simon-bot",
        owner: true,
      },
    ]);
  });

  it("should respond when addressed by its chosen name", async () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
    setMock.mockResolvedValue("OK");
    vi.mocked(getProfile).mockResolvedValue({ ...blankProfile, name: "Bob" });

    vi.mocked(getMessageChain).mockResolvedValue([
      {
        id: "msg-1",
        type: 0,
        username: "User1",
        content: "hey bob, you there?",
        fromOwner: false,
      },
    ]);

    async function* mockResponse() {
      yield "yep";
    }
    vi.mocked(createAnthropicMessage).mockReturnValue(mockResponse());
    vi.mocked(postChannelMessage).mockResolvedValue("response-1");

    await handleMessage(
      createMessage({ content: "User1: hey bob, you there?" }),
    );

    expect(postChannelMessage).toHaveBeenCalledWith(
      "yep",
      "simon-bot",
      "msg-1",
    );
  });

  it("should not treat a partial word as its chosen name", async () => {
    setMock.mockResolvedValue("OK");
    vi.mocked(getProfile).mockResolvedValue({ ...blankProfile, name: "Bob" });

    vi.mocked(getMessageChain).mockResolvedValue([
      {
        id: "msg-1",
        type: 0,
        username: "User1",
        content: "bobsleigh season",
        fromOwner: false,
      },
    ]);

    await handleMessage(createMessage({ content: "User1: bobsleigh season" }));

    expect(createAnthropicMessage).not.toHaveBeenCalled();
  });

  it("should still respond to its handle when the name lookup fails", async () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    setMock.mockResolvedValue("OK");
    vi.mocked(getProfile).mockRejectedValue(new Error("db down"));

    vi.mocked(getMessageChain).mockResolvedValue([
      {
        id: "msg-1",
        type: 0,
        username: "User1",
        content: "hey simon-bot",
        fromOwner: false,
      },
    ]);

    async function* mockResponse() {
      yield "hello";
    }
    vi.mocked(createAnthropicMessage).mockReturnValue(mockResponse());
    vi.mocked(postChannelMessage).mockResolvedValue("response-1");

    await handleMessage(createMessage({ content: "User1: hey simon-bot" }));

    expect(postChannelMessage).toHaveBeenCalledWith(
      "hello",
      "simon-bot",
      "msg-1",
    );
    expect(errorSpy).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Failed to load the bot's chosen name",
    );
  });

  it("should reflect on the conversation after replying", async () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
    setMock.mockResolvedValue("OK");

    vi.mocked(getMessageChain).mockResolvedValue([
      {
        id: "msg-1",
        type: 0,
        username: "User1",
        content: "hey simon-bot",
        fromOwner: false,
      },
    ]);

    async function* mockResponse() {
      yield "one sec";
      yield "hello";
    }
    vi.mocked(createAnthropicMessage).mockReturnValue(mockResponse());
    vi.mocked(postChannelMessage).mockResolvedValue("response-1");

    await handleMessage(createMessage({ content: "User1: hey simon-bot" }));

    expect(reflect).toHaveBeenCalledWith(
      [
        {
          role: "user",
          username: "User1",
          content: "hey simon-bot",
          owner: false,
        },
      ],
      ["one sec", "hello"],
    );
  });

  it("should log a failed reflection without affecting the reply", async () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    setMock.mockResolvedValue("OK");
    vi.mocked(reflect).mockRejectedValue(new Error("reflection broke"));

    vi.mocked(getMessageChain).mockResolvedValue([
      {
        id: "msg-1",
        type: 0,
        username: "User1",
        content: "hey simon-bot",
        fromOwner: false,
      },
    ]);

    async function* mockResponse() {
      yield "hello";
    }
    vi.mocked(createAnthropicMessage).mockReturnValue(mockResponse());
    vi.mocked(postChannelMessage).mockResolvedValue("response-1");

    await handleMessage(createMessage({ content: "User1: hey simon-bot" }));
    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        { err: expect.any(Error), messageId: "msg-1" },
        "Bot reflection failed",
      );
    });
    expect(postChannelMessage).toHaveBeenCalledTimes(1);
  });

  it("should skip if chain is empty", async () => {
    setMock.mockResolvedValue("OK");
    vi.mocked(getMessageChain).mockResolvedValue([]);

    await handleMessage(createMessage({ content: "User1: hey simon-bot" }));

    expect(createAnthropicMessage).not.toHaveBeenCalled();
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

  it("should log error silently on pre-commitment failure", async () => {
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    setMock.mockResolvedValue("OK");

    vi.mocked(getMessageChain).mockRejectedValue(new Error("API error"));

    await handleMessage(createMessage({ content: "User1: hey simon-bot" }));

    expect(errorSpy).toHaveBeenCalled();
    expect(postChannelMessage).not.toHaveBeenCalled();
  });

  it("should post error message on post-commitment failure", async () => {
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    setMock.mockResolvedValue("OK");

    vi.mocked(getMessageChain).mockResolvedValue([
      {
        id: "msg-1",
        type: 0,
        username: "User1",
        content: "hey simon-bot!",
        fromOwner: false,
      },
    ]);

    async function* failingResponse(): AsyncGenerator<string> {
      yield await Promise.reject(new Error("Anthropic error"));
    }
    vi.mocked(createAnthropicMessage).mockReturnValue(failingResponse());
    vi.mocked(postChannelMessage).mockResolvedValue("error-msg-id");

    await handleMessage(createMessage({ content: "User1: hey simon-bot!" }));

    expect(errorSpy).toHaveBeenCalled();
    expect(postChannelMessage).toHaveBeenCalledWith(
      "oops, something went wrong... try again later!",
      "simon-bot",
      "msg-1",
    );
  });
});

describe("startBotSubscription", () => {
  it("should subscribe to messages with handleMessage", async () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
    vi.mocked(subscribeToMessages).mockResolvedValue(() => {});

    await startBotSubscription();

    expect(subscribeToMessages).toHaveBeenCalledWith(handleMessage);
  });
});
