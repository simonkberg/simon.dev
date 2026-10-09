// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMessage as createAnthropicMessage } from "@/lib/anthropic";
import { log } from "@/lib/log";
import { MIGRATIONS } from "@/lib/migrations";
import { reflect } from "@/lib/reflection";
import { query } from "@/lib/turso";
import { createSqliteQuery, emptyResult } from "@/mocks/sqlite";

import { getMessageChain, postChannelMessage } from "./api";
import { handleMessage, startBotSubscription } from "./bot";
import { subscribeToMessages } from "./gateway";
import type { DiscordMessage } from "./schemas";

vi.mock(import("server-only"), () => ({}));

vi.mock(import("@/lib/turso"), () => ({ query: vi.fn() }));

function mockSeen(isNew: boolean) {
  vi.mocked(query).mockResolvedValue({
    ...emptyResult,
    rowsAffected: isNew ? 1 : 0,
  });
}

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

describe("handleMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reflect).mockResolvedValue(undefined);
    mockSeen(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should respond when bot is mentioned in the message", async () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
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

  it("should still respond when pruning seen messages fails", async () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const err = new Error("boom");
    vi.mocked(query)
      .mockResolvedValueOnce({ ...emptyResult, rowsAffected: 1 })
      .mockRejectedValueOnce(err);
    vi.mocked(getMessageChain).mockResolvedValue([
      { id: "msg-1", type: 0, username: "User1", content: "hey simon-bot!" },
    ]);
    async function* mockResponse() {
      yield "hello there!";
    }
    vi.mocked(createAnthropicMessage).mockReturnValue(mockResponse());
    vi.mocked(postChannelMessage).mockResolvedValue("response-1");

    await handleMessage(createMessage({ content: "User1: hey simon-bot!" }));

    expect(warn).toHaveBeenCalledWith({ err }, "Failed to prune seen messages");
    expect(postChannelMessage).toHaveBeenCalledWith(
      "hello there!",
      "simon-bot",
      "msg-1",
    );
  });

  it("should not respond when bot is not mentioned", async () => {
    await handleMessage(createMessage({ content: "User1: hello world" }));

    expect(query).not.toHaveBeenCalled();
    expect(getMessageChain).not.toHaveBeenCalled();
    expect(postChannelMessage).not.toHaveBeenCalled();
  });

  it("should not respond to a reply when nothing in the chain mentions the bot", async () => {
    vi.mocked(getMessageChain).mockResolvedValue([
      { id: "msg-1", type: 0, username: "User1", content: "hello" },
      { id: "msg-2", type: 19, username: "User2", content: "hi" },
    ]);

    await handleMessage(
      createMessage({
        type: 19,
        id: "msg-2",
        message_reference: { message_id: "msg-1" },
        content: "User2: hi",
      }),
    );

    expect(getMessageChain).toHaveBeenCalledWith("msg-2");
    expect(postChannelMessage).not.toHaveBeenCalled();
  });

  it("should handle a message only once across instances", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => {});
    vi.mocked(query).mockImplementation(createSqliteQuery(MIGRATIONS));
    vi.mocked(getMessageChain).mockResolvedValue([]);

    const message = createMessage({ content: "User1: hey simon-bot" });
    await handleMessage(message);
    await handleMessage(message);

    expect(getMessageChain).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      { messageId: "msg-1" },
      "Message already handled by another instance",
    );
  });

  it("should forget handled messages after an hour", async () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
    vi.useFakeTimers({ now: 0 });
    vi.mocked(query).mockImplementation(createSqliteQuery(MIGRATIONS));
    vi.mocked(getMessageChain).mockResolvedValue([]);
    const seen = async () =>
      (await query("SELECT id FROM seen_messages ORDER BY id")).rows;

    await handleMessage(
      createMessage({ id: "1", content: "User1: simon-bot" }),
    );
    vi.setSystemTime(60 * 60 * 1000 - 1);
    await handleMessage(
      createMessage({ id: "2", content: "User1: simon-bot" }),
    );
    expect(await seen()).toEqual([{ id: "1" }, { id: "2" }]);

    vi.setSystemTime(60 * 60 * 1000);
    await handleMessage(
      createMessage({ id: "3", content: "User1: simon-bot" }),
    );
    expect(await seen()).toEqual([{ id: "2" }, { id: "3" }]);
  });

  it("should respond when bot is mentioned in parent message", async () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
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
      createMessage({
        type: 19,
        id: "msg-2",
        message_reference: { message_id: "msg-1" },
        content: "User2: thanks!",
      }),
    );

    expect(postChannelMessage).toHaveBeenCalledWith(
      "you're welcome!",
      "simon-bot",
      "msg-2",
    );
  });

  it("should map bot messages to assistant role in conversation", async () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
    vi.mocked(getMessageChain).mockResolvedValue([
      { id: "msg-1", type: 0, username: "User1", content: "hey simon-bot!" },
      { id: "msg-2", type: 19, username: "simon-bot", content: "hello there!" },
      { id: "msg-3", type: 19, username: "User1", content: "thanks!" },
    ]);

    async function* mockResponse() {
      yield "you're welcome!";
    }
    vi.mocked(createAnthropicMessage).mockReturnValue(mockResponse());
    vi.mocked(postChannelMessage).mockResolvedValue("response-1");

    await handleMessage(
      createMessage({
        type: 19,
        id: "msg-3",
        message_reference: { message_id: "msg-2" },
        content: "User1: thanks!",
      }),
    );

    expect(createAnthropicMessage).toHaveBeenCalledWith([
      { role: "user", username: "User1", content: "hey simon-bot!" },
      { role: "assistant", username: "simon-bot", content: "hello there!" },
      { role: "user", username: "User1", content: "thanks!" },
    ]);
  });

  it("should reflect on the conversation after replying", async () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
    vi.mocked(getMessageChain).mockResolvedValue([
      { id: "msg-1", type: 0, username: "User1", content: "hey simon-bot" },
    ]);

    async function* mockResponse() {
      yield "one sec";
      yield "hello";
    }
    vi.mocked(createAnthropicMessage).mockReturnValue(mockResponse());
    vi.mocked(postChannelMessage).mockResolvedValue("response-1");

    await handleMessage(createMessage({ content: "User1: hey simon-bot" }));

    expect(reflect).toHaveBeenCalledWith([
      { role: "user", username: "User1", content: "hey simon-bot" },
      { role: "assistant", username: "simon-bot", content: "one sec" },
      { role: "assistant", username: "simon-bot", content: "hello" },
    ]);
  });

  it("should still reflect when a later reply fails", async () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
    vi.spyOn(log, "error").mockImplementation(() => {});
    vi.mocked(getMessageChain).mockResolvedValue([
      { id: "msg-1", type: 0, username: "User1", content: "hey simon-bot" },
    ]);

    async function* mockResponse() {
      yield "one sec";
      throw new Error("model timed out");
    }
    vi.mocked(createAnthropicMessage).mockReturnValue(mockResponse());
    vi.mocked(postChannelMessage).mockResolvedValue("response-1");

    await handleMessage(createMessage({ content: "User1: hey simon-bot" }));

    expect(postChannelMessage).toHaveBeenCalledWith(
      "oops, something went wrong... try again later!",
      "simon-bot",
      "msg-1",
    );
    expect(reflect).toHaveBeenCalledWith([
      { role: "user", username: "User1", content: "hey simon-bot" },
      { role: "assistant", username: "simon-bot", content: "one sec" },
    ]);
  });

  it("should still reflect when the error message can't be posted either", async () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    vi.mocked(getMessageChain).mockResolvedValue([
      { id: "msg-1", type: 0, username: "User1", content: "hey simon-bot" },
    ]);

    async function* mockResponse() {
      yield "one sec";
      throw new Error("model timed out");
    }
    vi.mocked(createAnthropicMessage).mockReturnValue(mockResponse());
    vi.mocked(postChannelMessage)
      .mockResolvedValueOnce("response-1")
      .mockRejectedValueOnce(new Error("discord down"));

    await handleMessage(createMessage({ content: "User1: hey simon-bot" }));

    expect(errorSpy).toHaveBeenCalledWith(
      { err: expect.any(Error), messageId: "msg-1" },
      "Bot message handling failed",
    );
    expect(reflect).toHaveBeenCalledWith([
      { role: "user", username: "User1", content: "hey simon-bot" },
      { role: "assistant", username: "simon-bot", content: "one sec" },
    ]);
  });

  it("should reflect when the bot chose not to reply", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => {});
    vi.mocked(getMessageChain).mockResolvedValue([
      {
        id: "msg-1",
        type: 0,
        username: "simon",
        content: "simon-bot try sounding less like grok please",
      },
    ]);

    async function* mockResponse() {}
    vi.mocked(createAnthropicMessage).mockReturnValue(mockResponse());

    await handleMessage(
      createMessage({
        content: "simon-bot try sounding less like grok please",
      }),
    );

    expect(postChannelMessage).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      { messageId: "msg-1", replies: 0 },
      "Bot chose not to reply",
    );
    expect(reflect).toHaveBeenCalledWith([
      {
        role: "user",
        username: "simon",
        content: "simon-bot try sounding less like grok please",
      },
    ]);
  });

  it("should not reflect when the reply failed before anything was said", async () => {
    vi.spyOn(log, "error").mockImplementation(() => {});
    vi.mocked(getMessageChain).mockResolvedValue([
      { id: "msg-1", type: 0, username: "User1", content: "hey simon-bot" },
    ]);

    vi.mocked(createAnthropicMessage).mockImplementation(() => {
      throw new Error("model down");
    });
    vi.mocked(postChannelMessage).mockResolvedValue("response-1");

    await handleMessage(createMessage({ content: "User1: hey simon-bot" }));

    expect(reflect).not.toHaveBeenCalled();
  });

  it("should log a failed reflection without affecting the reply", async () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    vi.mocked(reflect).mockRejectedValue(new Error("reflection broke"));

    vi.mocked(getMessageChain).mockResolvedValue([
      { id: "msg-1", type: 0, username: "User1", content: "hey simon-bot" },
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
    vi.mocked(getMessageChain).mockResolvedValue([]);

    await handleMessage(createMessage({ content: "User1: hey simon-bot" }));

    expect(createAnthropicMessage).not.toHaveBeenCalled();
  });

  it("should skip if already seen (dedup)", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => {});
    mockSeen(false);

    await handleMessage(createMessage({ content: "User1: hey simon-bot" }));

    expect(getMessageChain).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      { messageId: "msg-1" },
      "Message already handled by another instance",
    );
  });

  it("should ignore non-standard message types", async () => {
    await handleMessage(
      createMessage({
        type: 7, // guild member join
        content: "User1: hey simon-bot!",
      }),
    );

    // Should exit early before dedup check
    expect(query).not.toHaveBeenCalled();
  });

  it("should skip bot's own messages", async () => {
    await handleMessage(createMessage({ content: "simon-bot: hello there!" }));

    // Should exit early before dedup check
    expect(query).not.toHaveBeenCalled();
  });

  it("should log error silently on pre-commitment failure", async () => {
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    vi.mocked(getMessageChain).mockRejectedValue(new Error("API error"));

    await handleMessage(createMessage({ content: "User1: hey simon-bot" }));

    expect(errorSpy).toHaveBeenCalled();
    expect(postChannelMessage).not.toHaveBeenCalled();
  });

  it("should post error message on post-commitment failure", async () => {
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    vi.mocked(getMessageChain).mockResolvedValue([
      { id: "msg-1", type: 0, username: "User1", content: "hey simon-bot!" },
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
