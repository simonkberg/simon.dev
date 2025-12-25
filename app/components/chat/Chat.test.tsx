import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatHistoryResult } from "@/actions/chat";
import type { Message } from "@/lib/discord/api";

import { Chat } from "./Chat";

vi.mock(import("server-only"), () => ({}));

describe("Chat", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "EventSource",
      class MockEventSource {
        close = vi.fn();
        onopen?: () => void;
        onmessage?: () => void;
        onerror?: () => void;
      },
    );
  });

  const createMessage = (overrides?: Partial<Message>): Message => ({
    id: "msg-1",
    content: "Test message",
    user: { name: "TestUser", color: "hsl(0 100% 50%)" },
    edited: false,
    replies: [],
    ...overrides,
  });

  it("displays error message when result status is error", async () => {
    const errorResult: ChatHistoryResult = {
      status: "error",
      error: "Failed to fetch",
    };

    await act(async () =>
      render(<Chat history={Promise.resolve(errorResult)} />),
    );

    expect(
      screen.getByText("Chat is temporarily unavailable :("),
    ).toBeInTheDocument();
  });

  it("renders messages on success", async () => {
    const successResult: ChatHistoryResult = {
      status: "ok",
      messages: [createMessage({ content: "Hello world" })],
    };

    await act(async () =>
      render(<Chat history={Promise.resolve(successResult)} />),
    );

    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  describe("reply flow", () => {
    it("shows reply preview when reply button is clicked", async () => {
      const user = userEvent.setup();
      const message = createMessage({ id: "target-msg", content: "Original" });
      const successResult: ChatHistoryResult = {
        status: "ok",
        messages: [message],
      };

      await act(async () =>
        render(<Chat history={Promise.resolve(successResult)} />),
      );

      expect(screen.queryByText("Replying to")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Reply" }));

      expect(screen.getByText("Replying to")).toBeInTheDocument();
    });

    it("shows reply preview for nested message", async () => {
      const user = userEvent.setup();
      const nestedMessage = createMessage({
        id: "nested-msg",
        content: "Nested reply",
      });
      const parentMessage = createMessage({
        id: "parent-msg",
        content: "Parent message",
        replies: [nestedMessage],
      });
      const successResult: ChatHistoryResult = {
        status: "ok",
        messages: [parentMessage],
      };

      await act(async () =>
        render(<Chat history={Promise.resolve(successResult)} />),
      );

      const replyButtons = screen.getAllByRole("button", { name: "Reply" });
      await user.click(replyButtons[1]!); // Click nested message's reply button

      expect(screen.getByText("Replying to")).toBeInTheDocument();
    });

    it("clears reply when clear button is clicked", async () => {
      const user = userEvent.setup();
      const message = createMessage({ id: "target-msg" });
      const successResult: ChatHistoryResult = {
        status: "ok",
        messages: [message],
      };

      await act(async () =>
        render(<Chat history={Promise.resolve(successResult)} />),
      );

      await user.click(screen.getByRole("button", { name: "Reply" }));
      expect(screen.getByText("Replying to")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Clear reply" }));
      expect(screen.queryByText("Replying to")).not.toBeInTheDocument();
    });

    it("hides reply preview when message is deleted", async () => {
      const user = userEvent.setup();
      const message = createMessage({
        id: "will-be-deleted",
        content: "Soon gone",
      });
      const initialResult: ChatHistoryResult = {
        status: "ok",
        messages: [message],
      };

      const { rerender } = await act(async () =>
        render(<Chat history={Promise.resolve(initialResult)} />),
      );

      await user.click(screen.getByRole("button", { name: "Reply" }));
      expect(screen.getByText("Replying to")).toBeInTheDocument();

      // Re-render with messages that don't include the replied-to message
      const updatedResult: ChatHistoryResult = {
        status: "ok",
        messages: [
          createMessage({ id: "different-msg", content: "New message" }),
        ],
      };

      await act(async () =>
        rerender(<Chat history={Promise.resolve(updatedResult)} />),
      );

      // Reply preview should be hidden since the message no longer exists
      expect(screen.queryByText("Replying to")).not.toBeInTheDocument();
    });
  });
});
