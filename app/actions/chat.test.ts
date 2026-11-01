import { cacheLife, cacheTag, refresh, updateTag } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  dismissChatTip,
  getChatHistory,
  postChatMessage,
  reactToChatMessage,
} from "@/actions/chat";
import { setChatTipDismissed } from "@/lib/chatTip";
import {
  addBotReaction,
  removeBotReaction,
  DiscordApiError,
  getChannelMessages,
  postChannelMessage,
} from "@/lib/discord/api";
import { identifiers } from "@/lib/identifiers";
import { isDeniedRequest } from "@/lib/ipDenyList";
import { log } from "@/lib/log";
import { MIGRATIONS } from "@/lib/migrations";
import { getSession, type Username } from "@/lib/session";
import { query } from "@/lib/turso";
import { createMessage } from "@/mocks/messages";
import { sqliteBeforeEach, selectRows } from "@/mocks/sqlite";

vi.mock(import("next/cache"), () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  refresh: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock(import("@/lib/identifiers"), async (importOriginal) => ({
  ...(await importOriginal()),
  identifiers: vi.fn(() =>
    Promise.resolve({ ip: "0.0.0.0", userAgent: "vitest" }),
  ),
}));
vi.mock(import("@/lib/session"), () => ({
  getSession: vi.fn(() =>
    Promise.resolve({ username: "test-user" as Username }),
  ),
}));
vi.mock(import("@/lib/ipDenyList"), () => ({
  isDeniedRequest: vi.fn(() => false),
}));
vi.mock(import("@/lib/chatTip"), () => ({ setChatTipDismissed: vi.fn() }));
vi.mock(import("@/lib/discord/api"));
vi.mock(import("@/lib/turso"), async () =>
  (await import("@/mocks/sqlite")).mockTurso(),
);

function post(text = "Hello!") {
  const formData = new FormData();
  formData.set("text", text);
  return postChatMessage(formData);
}

function fromIp(ip: string | undefined) {
  vi.mocked(identifiers).mockResolvedValue({ ip, userAgent: "vitest" });
}

function nextFromIp(ip: string) {
  vi.mocked(identifiers).mockResolvedValueOnce({ ip, userAgent: "vitest" });
}

async function postUpToTheLimit() {
  for (let i = 0; i < 5; i++) {
    expect(await post()).toEqual({ status: "ok" });
  }
}

sqliteBeforeEach(query, MIGRATIONS);

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000, toFake: ["Date"] });
});

describe("getChatHistory", () => {
  it("returns messages on success", async () => {
    const mockMessages = [
      createMessage({ id: "1", content: "First message" }),
      createMessage({ id: "2", content: "Second message" }),
    ];
    vi.mocked(getChannelMessages).mockResolvedValue(mockMessages);

    const result = await getChatHistory();

    expect(result).toEqual({ status: "ok", messages: mockMessages });
  });

  it("returns error and logs when Discord API fails", async () => {
    const error = new Error("Discord API error");
    vi.mocked(getChannelMessages).mockRejectedValue(error);

    const result = await getChatHistory();

    expect(result).toEqual({
      status: "error",
      error: "Failed to fetch chat history",
    });
    expect(log.error).toHaveBeenCalledWith(
      { err: error, action: "getChatHistory" },
      "Error fetching chat history",
    );
  });

  it("adds the site's reactions", async () => {
    vi.mocked(getChannelMessages).mockResolvedValue([
      createMessage({ id: "1" }),
    ]);
    await query({
      sql: "INSERT INTO reactions (message_id, emoji, username) VALUES ('1', '👍', 'a')",
    });

    expect(await getChatHistory()).toMatchObject({
      messages: [{ reactions: [{ emoji: "👍", count: 1, users: ["a"] }] }],
    });
  });

  it("sets cache life and tag", async () => {
    vi.mocked(getChannelMessages).mockResolvedValue([]);

    await getChatHistory();

    expect(cacheLife).toHaveBeenCalledWith("seconds");
    expect(cacheTag).toHaveBeenCalledWith("getChatHistory");
  });
});

describe("postChatMessage", () => {
  beforeEach(() => {
    vi.mocked(postChannelMessage).mockResolvedValue("msg-123");
  });

  it("posts message to Discord and returns ok on success", async () => {
    expect(await post("Hello everyone!")).toEqual({ status: "ok" });

    expect(postChannelMessage).toHaveBeenCalledWith(
      "Hello everyone!",
      "test-user",
      undefined,
    );
    expect(setChatTipDismissed).toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "test-user",
        messageId: "msg-123",
        action: "postChatMessage",
      }),
      "Hello everyone!",
    );
  });

  it("records who posted from where, when it knows the IP", async () => {
    await post();
    fromIp(undefined);
    await post();

    expect(
      await selectRows(
        query,
        "SELECT message_id, username, ip FROM chat_posts",
      ),
    ).toEqual([
      { message_id: "msg-123", username: "test-user", ip: "0.0.0.0" },
    ]);
  });

  it("rejects the sixth post in 30 seconds with the wait time", async () => {
    await postUpToTheLimit();
    vi.advanceTimersByTime(10_000);
    vi.mocked(postChannelMessage).mockClear();
    vi.mocked(setChatTipDismissed).mockClear();

    expect(await post()).toEqual({
      status: "error",
      error: "Rate limit exceeded. Wait 20 seconds before trying again.",
    });
    expect(postChannelMessage).not.toHaveBeenCalled();
    expect(setChatTipDismissed).not.toHaveBeenCalled();
  });

  it("turns away an IP on the deny list before rate limiting it", async () => {
    vi.mocked(isDeniedRequest).mockReturnValueOnce(true);

    expect(await post()).toEqual({
      status: "error",
      error: "Posting from your network is blocked.",
    });
    expect(isDeniedRequest).toHaveBeenCalledWith("0.0.0.0", "postChatMessage");
    expect(postChannelMessage).not.toHaveBeenCalled();
    expect(await selectRows(query, "SELECT * FROM rate_limits")).toEqual([]);
  });

  it("limits each IP separately", async () => {
    await postUpToTheLimit();
    nextFromIp("1.1.1.1");

    expect(await post()).toEqual({ status: "ok" });
  });

  it("limits an IPv6 /64 as one IP", async () => {
    fromIp("2001:db8:1:2::1");
    await postUpToTheLimit();
    nextFromIp("2001:db8:1:2:ffff::1");

    expect(await post()).toMatchObject({ status: "error" });

    nextFromIp("2001:db8:1:3::1");

    expect(await post()).toEqual({ status: "ok" });
  });

  it("limits by username when the IP is unavailable", async () => {
    fromIp(undefined);
    await postUpToTheLimit();
    nextFromIp("0.0.0.0");

    expect(await post()).toEqual({ status: "ok" });
  });

  it("bans whoever posts the Calendly spam", async () => {
    const spam = "Hoping to connect! https://calendly.com/melottogroup/30min";
    const banned = {
      status: "error",
      error: "You've been banned :) blow your shit off smooth",
    };

    expect(await post(spam)).toEqual(banned);
    expect(await post()).toEqual(banned);
    expect(await reactToChatMessage("123", "👍")).toEqual(banned);
    expect(postChannelMessage).not.toHaveBeenCalled();
  });

  it("rejects the spam without an IP to ban", async () => {
    fromIp(undefined);

    expect(await post("calendly.com/melottogroup")).toEqual({
      status: "error",
      error: "You've been banned :) blow your shit off smooth",
    });
    expect(await selectRows(query, "SELECT * FROM banned_networks")).toEqual(
      [],
    );
  });

  it("returns error and logs when Discord API fails", async () => {
    const error = new Error("Discord connection failed");
    vi.mocked(postChannelMessage).mockRejectedValue(error);

    expect(await post("Test message")).toEqual({
      status: "error",
      error: "Failed to post chat message",
    });
    expect(log.error).toHaveBeenCalledWith(
      { err: error, action: "postChatMessage" },
      "Error posting chat message",
    );
  });

  it("returns an error result when the request has no session", async () => {
    vi.mocked(getSession).mockRejectedValueOnce(new Error("No session"));

    expect(await post()).toEqual({
      status: "error",
      error: "Failed to post chat message",
    });
    expect(postChannelMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["no text field", undefined],
    ["empty text", ""],
    ["only whitespace", "   "],
  ])("rejects %s", async (_, text) => {
    const formData = new FormData();
    if (text !== undefined) formData.set("text", text);

    expect(await postChatMessage(formData)).toEqual({
      status: "error",
      error: "Failed to post chat message",
    });
    expect(postChannelMessage).not.toHaveBeenCalled();
  });

  it("rejects text over the length limit", async () => {
    expect(await post("x".repeat(500))).toEqual({ status: "ok" });

    expect(await post("x".repeat(501))).toEqual({
      status: "error",
      error: "Messages can be at most 500 characters long.",
    });
    expect(postChannelMessage).toHaveBeenCalledOnce();
  });
});

describe("reactToChatMessage", () => {
  beforeEach(() => {
    vi.mocked(addBotReaction).mockResolvedValue();
    vi.mocked(removeBotReaction).mockResolvedValue();
  });

  it("toggles the visitor's reaction and refreshes", async () => {
    expect(await reactToChatMessage("123", "👍")).toEqual({ status: "ok" });

    expect(
      await selectRows(
        query,
        "SELECT message_id, emoji, username FROM reactions",
      ),
    ).toEqual([{ message_id: "123", emoji: "👍", username: "test-user" }]);
    expect(updateTag).toHaveBeenCalledWith("getChatHistory");
    expect(refresh).toHaveBeenCalled();
  });

  it("returns an error result when the request has no session", async () => {
    vi.mocked(getSession).mockRejectedValueOnce(new Error("No session"));

    expect(await reactToChatMessage("123", "👍")).toEqual({
      status: "error",
      error: "Failed to react to chat message",
    });
  });

  it.each([
    ["a message ID that isn't a snowflake", "../123", "👍"],
    ["text that isn't one emoji", "123", "nice"],
  ])("rejects %s", async (_, messageId, emoji) => {
    expect(await reactToChatMessage(messageId, emoji)).toEqual({
      status: "error",
      error: "Failed to react to chat message",
    });
    expect(addBotReaction).not.toHaveBeenCalled();
  });

  it("turns away an IP on the deny list", async () => {
    vi.mocked(isDeniedRequest).mockReturnValueOnce(true);

    expect(await reactToChatMessage("123", "👍")).toEqual({
      status: "error",
      error: "Reacting from your network is blocked.",
    });
    expect(isDeniedRequest).toHaveBeenCalledWith(
      "0.0.0.0",
      "reactToChatMessage",
    );
  });

  it("rejects the 31st reaction in a minute", async () => {
    for (let i = 0; i < 30; i++) {
      expect(await reactToChatMessage("123", "👍")).toEqual({ status: "ok" });
    }

    expect(await reactToChatMessage("123", "👍")).toEqual({
      status: "error",
      error: "Rate limit exceeded. Wait 60 seconds before trying again.",
    });
  });

  it("counts malformed reactions against the limit", async () => {
    for (let i = 0; i < 30; i++) {
      await reactToChatMessage("not-an-id", "👍");
    }

    expect(await reactToChatMessage("123", "👍")).toEqual({
      status: "error",
      error: "Rate limit exceeded. Wait 60 seconds before trying again.",
    });
  });

  it("returns error when Discord rejects the reaction", async () => {
    vi.mocked(addBotReaction).mockRejectedValueOnce(new Error("Unknown"));

    expect(await reactToChatMessage("123", "👍")).toEqual({
      status: "error",
      error: "Failed to react to chat message",
    });
  });

  it("explains Discord's cap on emoji per message", async () => {
    // The module is automocked, so the constructor doesn't set the code.
    vi.mocked(addBotReaction).mockRejectedValueOnce(
      Object.assign(new DiscordApiError("Discord API error", 30010), {
        code: 30010,
      }),
    );

    expect(await reactToChatMessage("123", "👍")).toEqual({
      status: "error",
      error: "Discord allows 20 emoji per message",
    });
  });
});

describe("dismissChatTip", () => {
  it("dismisses the tip", async () => {
    await dismissChatTip();

    expect(setChatTipDismissed).toHaveBeenCalled();
  });
});
