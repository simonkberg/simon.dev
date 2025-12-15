import { cacheLife, cacheTag, refresh, updateTag } from "next/cache"; // Hoisted so it can be referenced in the Ratelimit mock below
import { after } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getChatHistory,
  postChatMessage,
  refreshChatHistory,
} from "@/actions/chat";
import {
  getChannelMessages,
  type Message,
  postChannelMessage,
} from "@/lib/discord/api";
import { identifiers } from "@/lib/identifiers";
import { log } from "@/lib/log";
import type { Username } from "@/lib/session";

// Hoisted so it can be referenced in the Ratelimit mock below
const limitMock = vi.hoisted(() => vi.fn());

vi.mock(import("server-only"), () => ({}));
vi.mock(import("@upstash/redis"));
// Untyped mock due to complexity of the actual module exports
vi.mock("@upstash/ratelimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@upstash/ratelimit")>();
  return {
    Ratelimit: vi.fn(
      class {
        limit = limitMock;
        static slidingWindow = actual.Ratelimit.slidingWindow;
      },
    ),
  };
});
vi.mock(import("next/cache"), () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  refresh: vi.fn(),
  updateTag: vi.fn(),
}));
vi.mock(import("next/server"), () => ({ after: vi.fn() }));
vi.mock(import("@/lib/identifiers"), () => ({
  identifiers: vi.fn(() =>
    Promise.resolve({ ip: "0.0.0.0", userAgent: "vitest" }),
  ),
}));
vi.mock(import("@/lib/session"), () => ({
  getSession: vi.fn(() =>
    Promise.resolve({ username: "test-user" as Username }),
  ),
}));
vi.mock(import("@/lib/discord/api"));
vi.mock(import("@/lib/redis"));

function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "123",
    user: { name: "test-user", color: "hsl(200 50% 50%)" },
    content: "Hello, world!",
    edited: false,
    replies: [],
    ...overrides,
  };
}

function mockRateLimitSuccess() {
  limitMock.mockResolvedValue({
    success: true,
    limit: 5,
    remaining: 4,
    reset: Date.now() + 30000,
    pending: Promise.resolve(),
  });
}

function mockRateLimitExceeded(resetInMs: number) {
  limitMock.mockResolvedValue({
    success: false,
    limit: 5,
    remaining: 0,
    reset: Date.now() + resetInMs,
    pending: Promise.resolve(),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("getChatHistory", () => {
  it("returns messages on success", async () => {
    const mockMessages = [
      createMockMessage({ id: "1", content: "First message" }),
      createMockMessage({ id: "2", content: "Second message" }),
    ];
    vi.mocked(getChannelMessages).mockResolvedValue(mockMessages);

    const result = await getChatHistory();

    expect(result).toEqual({ status: "ok", messages: mockMessages });
  });

  it("returns error and logs when Discord API fails", async () => {
    const logErrorSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    const error = new Error("Discord API error");
    vi.mocked(getChannelMessages).mockRejectedValue(error);

    const result = await getChatHistory();

    expect(result).toEqual({
      status: "error",
      error: "Failed to fetch chat history",
    });
    expect(logErrorSpy).toHaveBeenCalledWith(
      { err: error, action: "getChatHistory" },
      "Error fetching chat history",
    );
  });

  it("sets cache life and tag", async () => {
    vi.mocked(getChannelMessages).mockResolvedValue([]);

    await getChatHistory();

    expect(cacheLife).toHaveBeenCalledWith("seconds");
    expect(cacheTag).toHaveBeenCalledWith("getChatHistory");
  });
});

describe("refreshChatHistory", () => {
  it("calls updateTag and refresh", () => {
    refreshChatHistory();
    expect(updateTag).toHaveBeenCalledWith("getChatHistory");
    expect(refresh).toHaveBeenCalled();
  });
});

describe("postChatMessage", () => {
  it("returns rate limit error with wait time when limit exceeded", async () => {
    mockRateLimitExceeded(10000);
    const formData = new FormData();
    formData.set("text", "Test message");

    const result = await postChatMessage(formData);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toMatch(/Rate limit exceeded/);
      expect(result.error).toMatch(/\d+ seconds/);
    }
  });

  it("uses username as rate limit identifier when IP is unavailable", async () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
    vi.mocked(identifiers).mockResolvedValueOnce({
      ip: undefined,
      userAgent: "vitest",
    });
    mockRateLimitSuccess();
    vi.mocked(postChannelMessage).mockResolvedValue("msg-123");
    const formData = new FormData();
    formData.set("text", "Hello!");

    await postChatMessage(formData);

    expect(limitMock).toHaveBeenCalledWith("test-user", {
      ip: undefined,
      userAgent: "vitest",
    });
  });

  it("posts message to Discord and returns ok on success", async () => {
    const logInfoSpy = vi.spyOn(log, "info").mockImplementation(() => {});
    mockRateLimitSuccess();
    vi.mocked(postChannelMessage).mockResolvedValue("msg-123");
    const formData = new FormData();
    formData.set("text", "Hello everyone!");

    const result = await postChatMessage(formData);

    expect(result).toEqual({ status: "ok" });
    expect(limitMock).toHaveBeenCalledWith("0.0.0.0", {
      ip: "0.0.0.0",
      userAgent: "vitest",
    });
    expect(postChannelMessage).toHaveBeenCalledWith(
      "Hello everyone!",
      "test-user",
      undefined,
    );
    expect(logInfoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "test-user",
        messageId: "msg-123",
        action: "postChatMessage",
      }),
      "Hello everyone!",
    );
    // Only one after() call for rate limit pending
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("returns error and logs when Discord API fails", async () => {
    const logErrorSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    const error = new Error("Discord connection failed");
    mockRateLimitSuccess();
    vi.mocked(postChannelMessage).mockRejectedValue(error);
    const formData = new FormData();
    formData.set("text", "Test message");

    const result = await postChatMessage(formData);

    expect(result).toEqual({
      status: "error",
      error: "Failed to post chat message",
    });
    expect(logErrorSpy).toHaveBeenCalledWith(
      { err: error, action: "postChatMessage" },
      "Error posting chat message",
    );
  });

  it("returns error when form data is invalid", async () => {
    const formData = new FormData();
    // Missing 'text' field

    const result = await postChatMessage(formData);

    expect(result.status).toBe("error");
  });
});
