import { afterEach, describe, expect, it, vi } from "vitest";

import { createMessage } from "@/lib/anthropic";
import { postChannelMessage } from "@/lib/discord/api";
import { log } from "@/lib/log";

import { postChatMessage } from "./chat";

// @ts-expect-error - Mocking next/server for testing
vi.mock(import("next/server"), () => ({
  after: vi.fn((fn: () => void | Promise<void>) => {
    if (typeof fn === "function") {
      void fn();
    }
  }),
}));

vi.mock(import("@/lib/anthropic"), () => ({ createMessage: vi.fn() }));

vi.mock(import("@/lib/discord/api"), () => ({ postChannelMessage: vi.fn() }));

vi.mock(import("@/lib/identifiers"), () => ({
  identifiers: vi.fn(() =>
    Promise.resolve({ ip: "127.0.0.1", userAgent: "test" }),
  ),
}));

// @ts-expect-error - Mocking session for testing
vi.mock(import("@/lib/session"), () => ({
  getSession: vi.fn(() => Promise.resolve({ username: "TestUser" })),
}));

// @ts-expect-error - Mocking ratelimit for testing
vi.mock(import("@upstash/ratelimit"), () => ({
  Ratelimit: class {
    static slidingWindow = vi.fn(() => ({}));
    limit = vi.fn(() =>
      Promise.resolve({
        success: true,
        pending: Promise.resolve(),
        reset: Date.now() + 30000,
      }),
    );
  },
}));

// @ts-expect-error - Mocking redis for testing
vi.mock(import("@upstash/redis"), () => ({
  Redis: { fromEnv: vi.fn(() => ({})) },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("postChatMessage with simon-bot", () => {
  it("should trigger bot response when message contains 'simon-bot'", async () => {
    vi.mocked(postChannelMessage).mockResolvedValue("msg-123");
    vi.mocked(createMessage).mockResolvedValue("Hello! Nice to meet you.");

    const formData = new FormData();
    formData.set("text", "Hey simon-bot, how are you?");

    const result = await postChatMessage(formData);

    expect(result).toEqual({ status: "ok" });
    expect(postChannelMessage).toHaveBeenCalledWith(
      "Hey simon-bot, how are you?",
      "TestUser",
    );
    expect(createMessage).toHaveBeenCalledWith("Hey simon-bot, how are you?");
    expect(postChannelMessage).toHaveBeenCalledWith(
      "Hello! Nice to meet you.",
      "simon-bot",
      "msg-123",
    );
  });

  it("should match simon-bot with word boundaries (case insensitive)", async () => {
    vi.mocked(postChannelMessage).mockResolvedValue("msg-456");
    vi.mocked(createMessage).mockResolvedValue("Response text");

    const testCases = [
      "simon-bot help",
      "Hey Simon-Bot!",
      "SIMON-BOT what's up?",
      "Can simon-bot help me?",
    ];

    for (const text of testCases) {
      const formData = new FormData();
      formData.set("text", text);
      await postChatMessage(formData);
    }

    expect(createMessage).toHaveBeenCalledTimes(testCases.length);
  });

  it("should not trigger bot for partial matches", async () => {
    vi.mocked(postChannelMessage).mockResolvedValue("msg-789");

    const formData = new FormData();
    formData.set("text", "simon-bots are cool");

    await postChatMessage(formData);

    expect(createMessage).not.toHaveBeenCalled();
  });

  it("should post error message when bot response fails", async () => {
    const logErrorSpy = vi.spyOn(log, "error").mockImplementation(() => {});

    vi.mocked(postChannelMessage).mockResolvedValue("msg-error");
    vi.mocked(createMessage).mockRejectedValue(new Error("API error"));

    const formData = new FormData();
    formData.set("text", "simon-bot test");

    await postChatMessage(formData);

    expect(postChannelMessage).toHaveBeenCalledWith(
      "Sorry, I couldn't process that right now.",
      "simon-bot",
      "msg-error",
    );
    expect(logErrorSpy).toHaveBeenCalled();
  });

  it("should not trigger bot when message does not contain simon-bot", async () => {
    vi.mocked(postChannelMessage).mockResolvedValue("msg-normal");

    const formData = new FormData();
    formData.set("text", "Just a normal message");

    await postChatMessage(formData);

    expect(postChannelMessage).toHaveBeenCalledTimes(1);
    expect(createMessage).not.toHaveBeenCalled();
  });
});
