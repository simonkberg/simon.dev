import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refreshClientCache } from "@/actions/cache";
import type { ChatHistoryResult } from "@/actions/chat";
import type { Message } from "@/lib/discord/api";

import { ChatHistory } from "./ChatHistory";

vi.mock(import("@/actions/cache"), () => ({ refreshClientCache: vi.fn() }));

function createMockEventSource() {
  const instances: MockEventSource[] = [];

  class MockEventSource {
    #onopen?: () => void;
    #onmessage?: () => void;
    #onerror?: () => void;
    close = vi.fn();

    constructor() {
      instances.push(this);
    }

    set onopen(handler: () => void) {
      this.#onopen = handler;
    }

    get onopen() {
      return this.#onopen ?? (() => {});
    }

    set onmessage(handler: () => void) {
      this.#onmessage = handler;
    }

    get onmessage() {
      return this.#onmessage ?? (() => {});
    }

    set onerror(handler: () => void) {
      this.#onerror = handler;
    }

    get onerror() {
      return this.#onerror ?? (() => {});
    }
  }

  return {
    MockEventSource,
    instances,
    getInstance(index = -1) {
      const instance = instances.at(index);
      if (!instance) {
        throw new Error(`No EventSource instance at ${index} available`);
      }
      return instance;
    },
  };
}

describe("ChatHistory", () => {
  let mockEventSource: ReturnType<typeof createMockEventSource>;

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    mockEventSource = createMockEventSource();
    vi.stubGlobal("EventSource", mockEventSource.MockEventSource);
  });

  it("renders messages as list with deeply nested replies", async () => {
    const mockMessages: Message[] = [
      {
        id: "1234567890123456",
        content: "Message without replies",
        user: { name: "User1", color: "hsl(0 100% 50%)" },
        edited: false,
        replies: [],
      },
      {
        id: "1234567890234567",
        content: "Message with replies",
        user: { name: "User2", color: "hsl(120 100% 50%)" },
        edited: false,
        replies: [
          {
            id: "1234567890345678",
            content: "First reply",
            user: { name: "User3", color: "hsl(240 100% 50%)" },
            edited: false,
            replies: [
              {
                id: "1234567890567890",
                content: "Nested reply to first",
                user: { name: "User5", color: "hsl(180 100% 50%)" },
                edited: false,
                replies: [
                  {
                    id: "1234567890678901",
                    content: "Deeply nested reply",
                    user: { name: "User6", color: "hsl(300 100% 50%)" },
                    edited: false,
                    replies: [],
                  },
                ],
              },
            ],
          },
          {
            id: "1234567890456789",
            content: "Second reply",
            user: { name: "User4", color: "hsl(60 100% 50%)" },
            edited: true,
            replies: [],
          },
        ],
      },
    ];

    const successResult: ChatHistoryResult = {
      status: "ok",
      messages: mockMessages,
    };

    await act(() =>
      render(<ChatHistory history={Promise.resolve(successResult)} />),
    );

    // 1 content list + 3 nested lists (replies → nested reply → deeply nested)
    expect(screen.getAllByRole("list")).toHaveLength(4);

    expect(screen.getByText("Message without replies")).toBeInTheDocument();
    expect(screen.getByText("Message with replies")).toBeInTheDocument();
    expect(screen.getByText("First reply")).toBeInTheDocument();
    expect(screen.getByText("Nested reply to first")).toBeInTheDocument();
    expect(screen.getByText("Deeply nested reply")).toBeInTheDocument();
    expect(screen.getByText("Second reply")).toBeInTheDocument();
  });

  it("displays error message when history fetch fails", async () => {
    const errorResult: ChatHistoryResult = {
      status: "error",
      error: "Failed to fetch chat history",
    };

    await act(() =>
      render(<ChatHistory history={Promise.resolve(errorResult)} />),
    );

    expect(
      screen.getByText("Chat is temporarily unavailable :("),
    ).toBeInTheDocument();
  });

  describe("SSE connection", () => {
    const successResult = Promise.resolve<ChatHistoryResult>({
      status: "ok",
      messages: [],
    });

    it("calls refreshClientCache when SSE message is received", async () => {
      const { getInstance } = mockEventSource;

      await act(() => render(<ChatHistory history={successResult} />));

      const instance = getInstance();

      instance.onmessage();

      expect(refreshClientCache).toHaveBeenCalled();
    });

    it("closes EventSource on unmount", async () => {
      const { getInstance } = mockEventSource;

      const { unmount } = await act(() =>
        render(<ChatHistory history={successResult} />),
      );

      const instance = getInstance();

      unmount();

      expect(instance.close).toHaveBeenCalled();
    });

    it("reconnects with exponential backoff on SSE error", async () => {
      vi.useFakeTimers();

      const { getInstance, instances } = mockEventSource;

      await act(() => render(<ChatHistory history={successResult} />));

      const initialCount = instances.length;
      expect(initialCount).toBeGreaterThanOrEqual(1);

      // Get the last instance (the active one)
      const firstInstance = getInstance(-1);

      // Trigger error on first connection
      firstInstance.onerror?.();

      expect(firstInstance.close).toHaveBeenCalled();

      // Advance by first backoff (2^1 * 1000 = 2000ms)
      vi.advanceTimersByTime(2000);

      expect(instances.length).toBe(initialCount + 1);

      // Get the new instance
      const secondInstance = getInstance(-1);

      // Trigger another error
      secondInstance.onerror();

      // Advance by second backoff (2^2 * 1000 = 4000ms)
      vi.advanceTimersByTime(4000);

      expect(instances.length).toBe(initialCount + 2);
    });

    it("handles multiple onerror calls before reconnect", async () => {
      vi.useFakeTimers();

      const { getInstance, instances } = mockEventSource;

      await act(() => render(<ChatHistory history={successResult} />));

      const initialCount = instances.length;
      const instance = getInstance(-1);

      // Trigger onerror multiple times before reconnect timer fires
      instance.onerror();
      instance.onerror();
      instance.onerror();

      // close should only be called once (first onerror call)
      expect(instance.close).toHaveBeenCalledTimes(1);

      // Advance past the backoff - should still only create one new connection
      vi.advanceTimersByTime(30000);

      expect(instances.length).toBe(initialCount + 1);
    });

    it("resets reconnect attempts on successful connection", async () => {
      vi.useFakeTimers();

      const { getInstance, instances } = mockEventSource;

      await act(() => render(<ChatHistory history={successResult} />));

      const initialCount = instances.length;
      const firstInstance = getInstance(-1);

      // Trigger error to increase backoff
      firstInstance.onerror();
      vi.advanceTimersByTime(2000);

      const secondInstance = getInstance(-1);

      // Trigger onopen to reset attempts
      secondInstance.onopen();

      // Trigger another error
      secondInstance.onerror();

      // If attempts were reset, backoff should be 2s again (not 4s)
      vi.advanceTimersByTime(2000);

      expect(instances.length).toBe(initialCount + 2);
    });

    it("clears pending reconnect timer on unmount", async () => {
      vi.useFakeTimers();

      const { getInstance, instances } = mockEventSource;

      const { unmount } = await act(() =>
        render(<ChatHistory history={successResult} />),
      );

      const initialCount = instances.length;
      const firstInstance = getInstance(-1);

      // Trigger error to set reconnect timer
      firstInstance.onerror();

      // Unmount before timer fires
      unmount();

      // Advance timer - should not create new connection
      vi.advanceTimersByTime(2000);

      // No new connections should be created after unmount
      expect(instances.length).toBe(initialCount);
    });

    it("respects max backoff of 30 seconds", async () => {
      vi.useFakeTimers();

      const { getInstance, instances } = mockEventSource;

      await act(() => render(<ChatHistory history={successResult} />));

      // Trigger many errors to exceed max backoff
      for (let i = 0; i < 6; i++) {
        getInstance(i).onerror();
        // 2^6 * 1000 = 64000ms > 30000ms max
        vi.advanceTimersByTime(30000);
      }

      // After 6 errors, backoff would be 64s without cap
      // With 30s cap, we should have reconnected
      expect(instances.length).toBeGreaterThan(6);
    });
  });
});
