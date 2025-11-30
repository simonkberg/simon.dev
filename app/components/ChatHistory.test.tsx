import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatHistoryResult } from "@/actions/chat";
import type { Message } from "@/lib/discord/api";

import { ChatHistory } from "./ChatHistory";

vi.mock(import("@/actions/cache"), () => ({ refreshClientCache: vi.fn() }));

describe("ChatHistory", () => {
  beforeEach(() => {
    class MockEventSource {
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      close = vi.fn();
    }

    vi.stubGlobal("EventSource", MockEventSource);
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
});
