import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createMessage } from "@/mocks/messages";

import { ChatMessage, type ChatMessageProps } from "./ChatMessage";

const renderMessage = (overrides?: Partial<ChatMessageProps>) => {
  const props: ChatMessageProps = {
    ...createMessage(),
    replyToId: null,
    onReply: vi.fn(),
    ...overrides,
  };
  render(<ChatMessage {...props} />);
  return props;
};

describe("ChatMessage", () => {
  it("renders the user name", () => {
    renderMessage();

    expect(screen.getByText(/TestUser:/)).toBeInTheDocument();
  });

  it("renders the message content as markdown", () => {
    renderMessage({ content: "**Bold** text" });

    expect(screen.getByText("Bold").tagName).toBe("STRONG");
  });

  it("applies user color as CSS variable", () => {
    renderMessage();

    const messageElement = screen.getByText(/TestUser:/).parentElement;
    expect(messageElement).toHaveStyle({ "--user-color": "hsl(0 100% 50%)" });
  });

  it("shows edited indicator when edited is true", () => {
    renderMessage({ edited: true });

    expect(screen.getByText(/\(edited\)/)).toBeInTheDocument();
  });

  it("displays the timestamp as a narrow relative time", async () => {
    const timestamp = new Date(Date.now() - 5 * 60_000);

    await act(async () => renderMessage({ timestamp }));

    expect(screen.getByText("5m ago")).toHaveAttribute(
      "datetime",
      timestamp.toISOString(),
    );
  });

  it("does not show edited indicator when edited is false", () => {
    renderMessage({ edited: false });

    expect(screen.queryByText(/\(edited\)/)).not.toBeInTheDocument();
  });

  describe("reply button", () => {
    it("renders a Reply button", () => {
      renderMessage();

      expect(screen.getByRole("button", { name: "Reply" })).toHaveTextContent(
        "↩",
      );
    });

    it("replies to the message when clicked", async () => {
      const user = userEvent.setup();
      const { onReply } = renderMessage({ id: "test-message-id" });

      await user.click(screen.getByRole("button", { name: "Reply" }));

      expect(onReply).toHaveBeenCalledWith("test-message-id");
    });

    it("is disabled when this message is being replied to", () => {
      renderMessage({ id: "selected-message", replyToId: "selected-message" });

      expect(screen.getByRole("button", { name: "Reply" })).toBeDisabled();
    });

    it("is not disabled when a different message is being replied to", () => {
      renderMessage({ id: "this-message", replyToId: "other-message" });

      expect(screen.getByRole("button", { name: "Reply" })).toBeEnabled();
    });
  });

  it("offers adding a reaction from the toolbar while there are none", () => {
    renderMessage();

    expect(
      screen.getByRole("button", { name: "Add reaction" }),
    ).toHaveTextContent("☺");
    expect(screen.queryByRole("group", { name: "Reactions" })).toBeNull();
  });

  it("offers adding a reaction beside the existing ones", () => {
    renderMessage({ reactions: [{ emoji: "👍", count: 1, users: [] }] });

    const add = screen.getByRole("button", { name: "Add reaction" });
    expect(add).toHaveTextContent("+");
    expect(
      within(screen.getByRole("group", { name: "Reactions" })).getByRole(
        "button",
        { name: "Add reaction" },
      ),
    ).toBe(add);
  });

  it("shows only the text as a reply preview", () => {
    renderMessage({
      content: "Hello, world!",
      reactions: [{ emoji: "👍", count: 1, users: [] }],
      preview: true,
    });

    expect(screen.getByText("Hello, world!")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { hidden: true })).toEqual([]);
  });
});
