import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Message } from "@/lib/discord/api";

import { ChatMessage } from "./ChatMessage";

describe("ChatMessage", () => {
  const mockUser = { name: "TestUser", color: "hsl(0 100% 50%)" } as const;

  const createMessage = (overrides?: Partial<Message>): Message => ({
    id: "1234567890123456",
    content: "Hello, world!",
    user: mockUser,
    edited: false,
    replies: [],
    ...overrides,
  });

  const defaultReplyProps = { replyToId: null, setReplyToId: vi.fn() };

  it("renders the user name", () => {
    const message = createMessage();
    render(<ChatMessage {...message} {...defaultReplyProps} />);

    expect(screen.getByText(/TestUser:/)).toBeInTheDocument();
  });

  it("renders the message content as HTML", () => {
    const message = createMessage({
      content: "<strong>Bold</strong> and <em>italic</em>",
    });
    render(<ChatMessage {...message} {...defaultReplyProps} />);

    expect(screen.getByText("Bold")).toBeInTheDocument();
    expect(screen.getByText("italic")).toBeInTheDocument();
  });

  it("applies user color as CSS variable", () => {
    const message = createMessage();
    render(<ChatMessage {...message} {...defaultReplyProps} />);

    const messageElement = screen.getByText(/TestUser:/).parentElement;
    expect(messageElement).toHaveStyle({ "--user-color": "hsl(0 100% 50%)" });
  });

  it("shows edited indicator when edited is true", () => {
    const message = createMessage({ edited: true });
    render(<ChatMessage {...message} {...defaultReplyProps} />);

    expect(screen.getByText(/\(edited\)/)).toBeInTheDocument();
  });

  it("does not show edited indicator when edited is false", () => {
    const message = createMessage({ edited: false });
    render(<ChatMessage {...message} {...defaultReplyProps} />);

    expect(screen.queryByText(/\(edited\)/)).not.toBeInTheDocument();
  });

  describe("reply button", () => {
    it("renders reply button with aria-label", () => {
      const message = createMessage();
      render(<ChatMessage {...message} {...defaultReplyProps} />);

      const replyButton = screen.getByRole("button", { name: "Reply" });
      expect(replyButton).toBeInTheDocument();
      expect(replyButton).toHaveTextContent("↩");
    });

    it("calls setReplyToId with message id when clicked", async () => {
      const user = userEvent.setup();
      const setReplyToId = vi.fn();
      const message = createMessage({ id: "test-message-id" });
      render(
        <ChatMessage
          {...message}
          replyToId={null}
          setReplyToId={setReplyToId}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Reply" }));

      expect(setReplyToId).toHaveBeenCalledWith("test-message-id");
    });

    it("is disabled when this message is being replied to", () => {
      const message = createMessage({ id: "selected-message" });
      render(
        <ChatMessage
          {...message}
          replyToId="selected-message"
          setReplyToId={vi.fn()}
        />,
      );

      expect(screen.getByRole("button", { name: "Reply" })).toBeDisabled();
    });

    it("is not disabled when a different message is being replied to", () => {
      const message = createMessage({ id: "this-message" });
      render(
        <ChatMessage
          {...message}
          replyToId="other-message"
          setReplyToId={vi.fn()}
        />,
      );

      expect(screen.getByRole("button", { name: "Reply" })).toBeEnabled();
    });

    it("has reply class for styling", () => {
      const message = createMessage();
      render(<ChatMessage {...message} {...defaultReplyProps} />);

      expect(screen.getByRole("button", { name: "Reply" })).toHaveClass(
        "reply",
      );
    });
  });
});
