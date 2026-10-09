import { cacheLife, cacheTag, refresh, updateTag } from "next/cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  dismissChatTip,
  getChatHistory,
  postChatMessage,
  refreshChatHistory,
} from "@/actions/chat";
import { setChatTipDismissed } from "@/lib/chatTip";
import {
  getChannelMessages,
  type Message,
  postChannelMessage,
} from "@/lib/discord/api";
import { resetGlobal } from "@/lib/global";
import { identifiers } from "@/lib/identifiers";
import { log } from "@/lib/log";
import { MIGRATIONS } from "@/lib/migrations";
import type { Username } from "@/lib/session";
import { query } from "@/lib/turso";
import { createSqliteQuery } from "@/mocks/sqlite";

vi.mock(import("server-only"), () => ({}));
vi.mock(import("next/cache"), () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  refresh: vi.fn(),
  updateTag: vi.fn(),
}));
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
vi.mock(import("@/lib/chatTip"), () => ({ setChatTipDismissed: vi.fn() }));
vi.mock(import("@/lib/discord/api"));
vi.mock(import("@/lib/turso"), () => ({ query: vi.fn() }));

function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "123",
    user: { name: "test-user", color: "hsl(200 50% 50%)" },
    content: "Hello, world!",
    edited: false,
    timestamp: new Date("2025-01-01T00:00:00.000000+00:00"),
    replies: [],
    ...overrides,
  };
}

function post(text = "Hello!") {
  const formData = new FormData();
  formData.set("text", text);
  return postChatMessage(formData);
}

async function postUpToTheLimit() {
  for (let i = 0; i < 5; i++) {
    expect(await post()).toEqual({ status: "ok" });
  }
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
  it("calls updateTag and refresh", async () => {
    await refreshChatHistory();
    expect(updateTag).toHaveBeenCalledWith("getChatHistory");
    expect(refresh).toHaveBeenCalled();
  });
});

describe("postChatMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ["Date"] });
    vi.spyOn(log, "info").mockImplementation(() => {});
    vi.spyOn(log, "error").mockImplementation(() => {});
    resetGlobal("simon.dev/rate-limit-blocked");
    vi.mocked(query).mockImplementation(createSqliteQuery(MIGRATIONS));
    vi.mocked(postChannelMessage).mockResolvedValue("msg-123");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it("rejects the sixth post in 30 seconds with the wait time", async () => {
    await postUpToTheLimit();
    vi.clearAllMocks();
    vi.advanceTimersByTime(10_000);

    expect(await post()).toEqual({
      status: "error",
      error: "Rate limit exceeded. Wait 20 seconds before trying again.",
    });
    expect(postChannelMessage).not.toHaveBeenCalled();
    expect(setChatTipDismissed).not.toHaveBeenCalled();
  });

  it("limits each IP separately", async () => {
    await postUpToTheLimit();
    vi.mocked(identifiers).mockResolvedValueOnce({
      ip: "1.1.1.1",
      userAgent: "vitest",
    });

    expect(await post()).toEqual({ status: "ok" });
  });

  it("limits by username when the IP is unavailable", async () => {
    vi.mocked(identifiers).mockResolvedValue({
      ip: undefined,
      userAgent: "vitest",
    });
    await postUpToTheLimit();
    vi.mocked(identifiers).mockResolvedValueOnce({
      ip: "0.0.0.0",
      userAgent: "vitest",
    });

    expect(await post()).toEqual({ status: "ok" });
  });

  it("returns error and logs when Discord API fails", async () => {
    const logErrorSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    const error = new Error("Discord connection failed");
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

  it("returns error when text is empty", async () => {
    const formData = new FormData();
    formData.set("text", "");

    const result = await postChatMessage(formData);

    expect(result.status).toBe("error");
  });

  it("returns error when text is only whitespace", async () => {
    const formData = new FormData();
    formData.set("text", "   ");

    const result = await postChatMessage(formData);

    expect(result.status).toBe("error");
  });
});

describe("dismissChatTip", () => {
  it("dismisses the tip", async () => {
    await dismissChatTip();

    expect(setChatTipDismissed).toHaveBeenCalled();
  });
});
