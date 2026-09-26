import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Message } from "@/lib/discord/api";

import { ChatHistory } from "./ChatHistory";

describe("ChatHistory", () => {
  const defaultReplyProps = { replyToId: null, setReplyToId: vi.fn() };

  it("renders messages as list with deeply nested replies", () => {
    const mockMessages: Message[] = [
      {
        id: "1234567890123456",
        content: "Message without replies",
        user: { name: "User1", color: "hsl(0 100% 50%)" },
        edited: false,
        timestamp: new Date("2025-01-01T00:00:00.000000+00:00"),
        replies: [],
      },
      {
        id: "1234567890234567",
        content: "Message with replies",
        user: { name: "User2", color: "hsl(120 100% 50%)" },
        edited: false,
        timestamp: new Date("2025-01-01T00:01:00.000000+00:00"),
        replies: [
          {
            id: "1234567890345678",
            content: "First reply",
            user: { name: "User3", color: "hsl(240 100% 50%)" },
            edited: false,
            timestamp: new Date("2025-01-01T00:02:00.000000+00:00"),
            replies: [
              {
                id: "1234567890567890",
                content: "Nested reply to first",
                user: { name: "User5", color: "hsl(180 100% 50%)" },
                edited: false,
                timestamp: new Date("2025-01-01T00:03:00.000000+00:00"),
                replies: [
                  {
                    id: "1234567890678901",
                    content: "Deeply nested reply",
                    user: { name: "User6", color: "hsl(300 100% 50%)" },
                    edited: false,
                    timestamp: new Date("2025-01-01T00:04:00.000000+00:00"),
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
            timestamp: new Date("2025-01-01T00:05:00.000000+00:00"),
            replies: [],
          },
        ],
      },
    ];

    render(<ChatHistory messages={mockMessages} {...defaultReplyProps} />);

    // 1 content list + 3 nested lists (replies → nested reply → deeply nested)
    expect(screen.getAllByRole("list")).toHaveLength(4);

    expect(screen.getByText("Message without replies")).toBeInTheDocument();
    expect(screen.getByText("Message with replies")).toBeInTheDocument();
    expect(screen.getByText("First reply")).toBeInTheDocument();
    expect(screen.getByText("Nested reply to first")).toBeInTheDocument();
    expect(screen.getByText("Deeply nested reply")).toBeInTheDocument();
    expect(screen.getByText("Second reply")).toBeInTheDocument();
  });

  it("renders empty list when no messages", () => {
    render(<ChatHistory messages={[]} {...defaultReplyProps} />);

    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
