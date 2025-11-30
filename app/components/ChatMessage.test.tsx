import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Message } from "@/lib/discord";

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

  it("renders the user name", () => {
    const message = createMessage();
    render(<ChatMessage {...message} />);

    expect(screen.getByText(/TestUser:/)).toBeInTheDocument();
  });

  it("renders the message content", () => {
    const message = createMessage({ content: "This is a test message" });
    render(<ChatMessage {...message} />);

    expect(screen.getByText("This is a test message")).toBeInTheDocument();
  });

  it("applies user color as CSS variable", () => {
    const message = createMessage();
    render(<ChatMessage {...message} />);

    const messageElement = screen.getByText(/TestUser:/).parentElement;
    expect(messageElement).toHaveStyle({ "--user-color": "hsl(0 100% 50%)" });
  });

  it("shows edited indicator when edited is true", () => {
    const message = createMessage({ edited: true });
    render(<ChatMessage {...message} />);

    expect(screen.getByText(/\(edited\)/)).toBeInTheDocument();
  });

  it("does not show edited indicator when edited is false", () => {
    const message = createMessage({ edited: false });
    render(<ChatMessage {...message} />);

    expect(screen.queryByText(/\(edited\)/)).not.toBeInTheDocument();
  });

  it("renders markdown content using simple-markdown", () => {
    const message = createMessage({
      content: "**Bold text** and *italic text*",
    });
    render(<ChatMessage {...message} />);

    expect(screen.getByText("Bold text")).toBeInTheDocument();
    expect(screen.getByText("italic text")).toBeInTheDocument();
  });
});
