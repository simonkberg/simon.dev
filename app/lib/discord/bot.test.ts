// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMessage as createAnthropicMessage } from "@/lib/anthropic";
import { log } from "@/lib/log";
import { MIGRATIONS } from "@/lib/migrations";
import { reflect } from "@/lib/reflection";
import { query } from "@/lib/turso";
import { message } from "@/mocks/discord";
import { failQuery, sqliteBeforeEach } from "@/mocks/sqlite";

import {
  type ChainMessage,
  getMessageChain,
  isOwnPost,
  postChannelMessage,
  sendTyping,
} from "./api";
import { handleMessage, startBotSubscription } from "./bot";
import { subscribe } from "./gateway";

vi.mock(import("@/lib/turso"), () => ({ query: vi.fn() }));

vi.mock(import("@/lib/reflection"), () => ({ reflect: vi.fn() }));

vi.mock(import("./api"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getMessageChain: vi.fn(),
    isOwnPost: vi.fn(),
    postChannelMessage: vi.fn(),
    sendTyping: vi.fn(() => Promise.resolve()),
  };
});

vi.mock(import("@/lib/anthropic"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createMessage: vi.fn() };
});

vi.mock(import("./gateway"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, subscribe: vi.fn() };
});

function link(
  id: string,
  type: number,
  username: string,
  content: string,
  reactions: ChainMessage["reactions"] = [],
): ChainMessage {
  return { id, type, username, content, reactions };
}

function replyWith(...texts: string[]) {
  vi.mocked(createAnthropicMessage).mockImplementation(async function* () {
    yield* texts;
  });
}

function failAfter(...texts: string[]) {
  vi.mocked(createAnthropicMessage).mockImplementation(async function* () {
    yield* texts;
    throw new Error("model timed out");
  });
}

const heyTurn = {
  role: "user",
  id: "msg-1",
  username: "User1",
  content: "hey simon-bot",
  reactions: [],
};

const OOPS = "oops, something went wrong... try again later!";

const sqlite = sqliteBeforeEach(query, MIGRATIONS);

beforeEach(() => {
  vi.mocked(reflect).mockResolvedValue(undefined);
  vi.mocked(postChannelMessage).mockResolvedValue("response-1");
});

describe("handleMessage", () => {
  beforeEach(() => {
    vi.mocked(getMessageChain).mockResolvedValue([
      link("msg-1", 0, "User1", "hey simon-bot"),
    ]);
  });

  it("should respond when bot is mentioned in the message, even if pruning fails", async () => {
    vi.mocked(query).mockImplementation(failQuery(sqlite(), "DELETE"));
    replyWith("hello there!");

    await handleMessage(message("msg-1", { content: "User1: hey simon-bot!" }));

    expect(postChannelMessage).toHaveBeenCalledWith(
      "hello there!",
      "simon-bot",
      "msg-1",
    );
    expect(log.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Failed to prune seen messages",
    );
  });

  it("should show itself typing until it has replied", async () => {
    vi.useFakeTimers();
    const { promise: answered, resolve: answer } =
      Promise.withResolvers<void>();
    vi.mocked(createAnthropicMessage).mockImplementation(async function* () {
      await answered;
      yield "hello there!";
    });

    const handled = handleMessage(
      message("msg-1", { content: "User1: hey simon-bot!" }),
    );
    await vi.advanceTimersByTimeAsync(16_000);
    expect(sendTyping).toHaveBeenCalledTimes(3);
    answer();
    await handled;
    await vi.advanceTimersByTimeAsync(16_000);

    expect(sendTyping).toHaveBeenCalledTimes(3);
  });

  it("should post only once every typing call has landed, so it never types after replying", async () => {
    vi.useFakeTimers();
    const { promise: typed, resolve: land } = Promise.withResolvers<void>();
    vi.mocked(sendTyping).mockReturnValueOnce(typed);
    const { promise: answered, resolve: answer } =
      Promise.withResolvers<void>();
    vi.mocked(createAnthropicMessage).mockImplementation(async function* () {
      await answered;
      yield "hello there!";
    });

    const handled = handleMessage(
      message("msg-1", { content: "User1: hey simon-bot!" }),
    );
    await vi.advanceTimersByTimeAsync(8_000);
    expect(sendTyping).toHaveBeenCalledTimes(2);
    answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(postChannelMessage).not.toHaveBeenCalled();
    land();
    await handled;

    expect(postChannelMessage).toHaveBeenCalledOnce();
  });

  it("should reply even when it can't show itself typing", async () => {
    vi.mocked(sendTyping).mockRejectedValue(new Error("rate limited"));
    replyWith("hello there!");

    await handleMessage(message("msg-1", { content: "User1: hey simon-bot!" }));

    expect(postChannelMessage).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(
      { err: new Error("rate limited") },
      "Failed to show the bot typing",
    );
  });

  it("should not respond when bot is not mentioned", async () => {
    await handleMessage(message("msg-1", { content: "User1: hello world" }));

    expect(query).not.toHaveBeenCalled();
    expect(getMessageChain).not.toHaveBeenCalled();
    expect(postChannelMessage).not.toHaveBeenCalled();
  });

  const sitePost = message("msg-1", {
    author: { id: "bot-user-id", bot: true },
    content: "User1: hey simon-bot",
  });

  it("should answer its own site post", async () => {
    vi.mocked(isOwnPost).mockReturnValue(true);
    replyWith("hello there!");

    await handleMessage(sitePost);

    expect(postChannelMessage).toHaveBeenCalledExactlyOnceWith(
      "hello there!",
      "simon-bot",
      "msg-1",
    );
  });

  it("should leave another environment's site post", async () => {
    vi.mocked(isOwnPost).mockReturnValue(false);

    await handleMessage(sitePost);

    expect(postChannelMessage).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledExactlyOnceWith(
      { messageId: "msg-1" },
      "Site post from another environment",
    );
  });

  it("should not treat a forward as a reply", async () => {
    await handleMessage(
      message("msg-2", {
        message_reference: { type: 1, message_id: "msg-1" },
        content: "User2: look at this",
      }),
    );

    expect(query).not.toHaveBeenCalled();
    expect(getMessageChain).not.toHaveBeenCalled();
  });

  it("should not be summoned by a forward of someone else's mention", async () => {
    await handleMessage(
      message("msg-2", {
        content: "",
        message_reference: { type: 1, message_id: "msg-1" },
        message_snapshots: [{ message: { content: "User1: hey simon-bot" } }],
      }),
    );

    expect(query).not.toHaveBeenCalled();
    expect(getMessageChain).not.toHaveBeenCalled();
  });

  it("should not respond to a reply when nothing in the chain mentions the bot", async () => {
    vi.mocked(getMessageChain).mockResolvedValue([
      link("msg-1", 0, "User1", "hello"),
      link("msg-2", 19, "User2", "hi"),
    ]);

    await handleMessage(
      message("msg-2", {
        type: 19,
        message_reference: { message_id: "msg-1" },
        content: "User2: hi",
      }),
    );

    expect(getMessageChain).toHaveBeenCalledWith("msg-2");
    expect(postChannelMessage).not.toHaveBeenCalled();
  });

  it("should handle a message only once across instances", async () => {
    vi.mocked(getMessageChain).mockResolvedValue([]);

    const mention = message("msg-1", { content: "User1: hey simon-bot" });
    await handleMessage(mention);
    await handleMessage(mention);

    expect(getMessageChain).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith(
      { messageId: "msg-1" },
      "Message already handled by another instance",
    );
  });

  it("should forget handled messages after an hour", async () => {
    vi.useFakeTimers({ now: 0 });
    vi.mocked(getMessageChain).mockResolvedValue([]);
    const seen = async () =>
      (await query("SELECT id FROM seen_messages ORDER BY id")).rows;

    await handleMessage(message("1", { content: "User1: simon-bot" }));
    vi.setSystemTime(60 * 60 * 1000 - 1);
    await handleMessage(message("2", { content: "User1: simon-bot" }));
    expect(await seen()).toEqual([{ id: "1" }, { id: "2" }]);

    vi.setSystemTime(60 * 60 * 1000);
    await handleMessage(message("3", { content: "User1: simon-bot" }));
    expect(await seen()).toEqual([{ id: "2" }, { id: "3" }]);
  });

  it("should respond when bot is mentioned in parent message", async () => {
    vi.mocked(getMessageChain).mockResolvedValue([
      link("msg-1", 0, "User1", "hey simon-bot help"),
      link("msg-2", 19, "User2", "thanks!"),
    ]);
    replyWith("you're welcome!");

    await handleMessage(
      message("msg-2", {
        type: 19,
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
    vi.mocked(getMessageChain).mockResolvedValue([
      link("msg-1", 0, "User1", "hey simon-bot!"),
      link("msg-2", 19, "simon-bot", "hello there!"),
      link("msg-3", 19, "User1", "thanks!"),
    ]);
    replyWith("you're welcome!");

    await handleMessage(
      message("msg-3", {
        type: 19,
        message_reference: { message_id: "msg-2" },
        content: "User1: thanks!",
      }),
    );

    expect(createAnthropicMessage).toHaveBeenCalledWith([
      {
        role: "user",
        id: "msg-1",
        username: "User1",
        content: "hey simon-bot!",
        reactions: [],
      },
      {
        role: "assistant",
        id: "msg-2",
        username: "simon-bot",
        content: "hello there!",
        reactions: [],
      },
      {
        role: "user",
        id: "msg-3",
        username: "User1",
        content: "thanks!",
        reactions: [],
      },
    ]);
  });

  it("should show the bot each message's reactions, the site's included", async () => {
    await query(
      "INSERT INTO reactions (message_id, emoji, username) VALUES ('msg-1', '😂', 'otter')",
    );
    vi.mocked(getMessageChain).mockResolvedValue([
      link("msg-1", 0, "User1", "hey simon-bot", [
        { emoji: "😂", count: 1, users: [] },
      ]),
    ]);
    replyWith();

    await handleMessage(message("msg-1", { content: "User1: hey simon-bot" }));

    expect(createAnthropicMessage).toHaveBeenCalledWith([
      expect.objectContaining({
        reactions: [{ emoji: "😂", count: 2, users: ["otter"] }],
      }),
    ]);
  });

  it("should reflect on the conversation after replying", async () => {
    replyWith("one sec", "hello");

    await handleMessage(message("msg-1", { content: "User1: hey simon-bot" }));

    await vi.waitFor(() => expect(reflect).toHaveBeenCalled());
    expect(reflect).toHaveBeenCalledWith([
      heyTurn,
      { role: "assistant", username: "simon-bot", content: "one sec" },
      { role: "assistant", username: "simon-bot", content: "hello" },
    ]);
  });

  it("should still reflect when a later reply fails", async () => {
    failAfter("one sec");

    await handleMessage(message("msg-1", { content: "User1: hey simon-bot" }));

    expect(postChannelMessage).toHaveBeenCalledWith(OOPS, "simon-bot", "msg-1");
    await vi.waitFor(() => expect(reflect).toHaveBeenCalled());
    expect(reflect).toHaveBeenCalledWith([
      heyTurn,
      { role: "assistant", username: "simon-bot", content: "one sec" },
    ]);
  });

  it("should still reflect when the error message can't be posted either", async () => {
    failAfter("one sec");
    vi.mocked(postChannelMessage)
      .mockResolvedValueOnce("response-1")
      .mockRejectedValueOnce(new Error("discord down"));

    await handleMessage(message("msg-1", { content: "User1: hey simon-bot" }));

    expect(log.error).toHaveBeenCalledWith(
      { err: expect.any(Error), messageId: "msg-1" },
      "Bot message handling failed",
    );
    await vi.waitFor(() => expect(reflect).toHaveBeenCalled());
    expect(reflect).toHaveBeenCalledWith([
      heyTurn,
      { role: "assistant", username: "simon-bot", content: "one sec" },
    ]);
  });

  it("should reflect when the bot chose not to reply", async () => {
    vi.mocked(getMessageChain).mockResolvedValue([
      link("msg-1", 0, "simon", "simon-bot try sounding less like grok please"),
    ]);
    replyWith();

    await handleMessage(
      message("msg-1", {
        content: "simon-bot try sounding less like grok please",
      }),
    );

    expect(postChannelMessage).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      { messageId: "msg-1", replies: 0 },
      "Bot chose not to reply",
    );
    await vi.waitFor(() => expect(reflect).toHaveBeenCalled());
    expect(reflect).toHaveBeenCalledWith([
      {
        role: "user",
        id: "msg-1",
        username: "simon",
        content: "simon-bot try sounding less like grok please",
        reactions: [],
      },
    ]);
  });

  it("should reflect on what the bot reacted with", async () => {
    vi.mocked(getMessageChain).mockResolvedValue([
      link("msg-1", 0, "User1", "thanks simon-bot"),
    ]);

    async function* mockResponse() {
      await query(
        "INSERT INTO reactions (message_id, emoji, username) VALUES ('msg-1', '👍', 'simon-bot')",
      );
      // A react-only turn says nothing.
      yield* [];
    }
    vi.mocked(createAnthropicMessage).mockReturnValue(mockResponse());

    await handleMessage(message("msg-1", { content: "thanks simon-bot" }));

    await vi.waitFor(() => expect(reflect).toHaveBeenCalled());
    expect(reflect).toHaveBeenCalledWith([
      {
        role: "user",
        id: "msg-1",
        username: "User1",
        content: "thanks simon-bot",
        reactions: [{ emoji: "👍", count: 1, users: ["simon-bot"] }],
      },
    ]);
  });

  it("should post an error and not reflect when the reply fails before anything was said", async () => {
    failAfter();

    await handleMessage(message("msg-1", { content: "User1: hey simon-bot!" }));

    expect(postChannelMessage).toHaveBeenCalledExactlyOnceWith(
      OOPS,
      "simon-bot",
      "msg-1",
    );
    expect(log.error).toHaveBeenCalledWith(
      { err: new Error("model timed out"), messageId: "msg-1" },
      "Bot response failed",
    );
    // Reflection is fire-and-forget, so give it time to run had the guard let it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reflect).not.toHaveBeenCalled();
  });

  it("should log a failed reflection without affecting the reply", async () => {
    vi.mocked(reflect).mockRejectedValue(new Error("reflection broke"));
    replyWith("hello");

    await handleMessage(message("msg-1", { content: "User1: hey simon-bot" }));
    await vi.waitFor(() => {
      expect(log.error).toHaveBeenCalledWith(
        { err: expect.any(Error), messageId: "msg-1" },
        "Bot reflection failed",
      );
    });
    expect(postChannelMessage).toHaveBeenCalledTimes(1);
  });

  it("should skip if chain is empty", async () => {
    vi.mocked(getMessageChain).mockResolvedValue([]);

    await handleMessage(message("msg-1", { content: "User1: hey simon-bot" }));

    expect(createAnthropicMessage).not.toHaveBeenCalled();
  });

  it("should ignore non-standard message types", async () => {
    await handleMessage(
      message("msg-1", { type: 7, content: "User1: hey simon-bot!" }),
    );

    expect(query).not.toHaveBeenCalled();
  });

  it("should skip bot's own messages", async () => {
    await handleMessage(
      message("msg-1", { content: "simon-bot: hello there!" }),
    );

    expect(query).not.toHaveBeenCalled();
  });

  it("should log error silently on pre-commitment failure", async () => {
    vi.mocked(getMessageChain).mockRejectedValue(new Error("API error"));

    await handleMessage(message("msg-1", { content: "User1: hey simon-bot" }));

    expect(log.error).toHaveBeenCalledWith(
      { err: new Error("API error"), messageId: "msg-1" },
      "Bot message handling failed",
    );
    expect(postChannelMessage).not.toHaveBeenCalled();
  });
});

describe("startBotSubscription", () => {
  beforeEach(() => {
    vi.mocked(getMessageChain).mockResolvedValue([]);
    vi.mocked(subscribe).mockResolvedValue(() => {});
  });

  async function startAndGetSubscriber() {
    await startBotSubscription();
    const callback = vi.mocked(subscribe).mock.calls[0]?.[0];
    if (!callback) throw new Error("Bot did not subscribe");
    return callback;
  }

  it("should handle created messages", async () => {
    const callback = await startAndGetSubscriber();

    callback({
      t: "MESSAGE_CREATE",
      d: message("msg-1", { content: "hey simon-bot" }),
    });

    await vi.waitFor(() => {
      expect(getMessageChain).toHaveBeenCalledExactlyOnceWith("msg-1");
    });
  });

  it("should ignore message updates", async () => {
    const callback = await startAndGetSubscriber();

    callback({
      t: "MESSAGE_UPDATE",
      d: message("msg-1", { content: "hey simon-bot" }),
    });

    expect(query).not.toHaveBeenCalled();
  });
});
