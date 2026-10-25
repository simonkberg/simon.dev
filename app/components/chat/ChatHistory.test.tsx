import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Message } from "@/lib/discord/api";
import { createMessage } from "@/mocks/messages";

import { ChatHistory } from "./ChatHistory";

const message = (id: string, content: string, replies: Message[] = []) =>
  createMessage({ id, content, replies });

const renderHistory = (messages: Message[]) => {
  const props = { replyToId: null, setReplyToId: vi.fn() };
  const view = render(<ChatHistory messages={messages} {...props} />);
  return {
    ...view,
    update: (next: Message[]) =>
      view.rerender(<ChatHistory messages={next} {...props} />),
  };
};

describe("ChatHistory", () => {
  it("renders messages as list with deeply nested replies", () => {
    renderHistory([
      message("1", "Message without replies"),
      message("2", "Message with replies", [
        message("3", "First reply", [
          message("4", "Nested reply to first", [
            message("5", "Deeply nested reply"),
          ]),
        ]),
        message("6", "Second reply"),
      ]),
    ]);

    // 1 content list + 3 nested lists (replies → nested reply → deeply nested); the rest are empty
    expect(
      screen.getAllByRole("list").filter((list) => list.childElementCount > 0),
    ).toHaveLength(4);

    expect(screen.getByText("Message without replies")).toBeInTheDocument();
    expect(screen.getByText("Message with replies")).toBeInTheDocument();
    expect(screen.getByText("First reply")).toBeInTheDocument();
    expect(screen.getByText("Nested reply to first")).toBeInTheDocument();
    expect(screen.getByText("Deeply nested reply")).toBeInTheDocument();
    expect(screen.getByText("Second reply")).toBeInTheDocument();
  });

  it("renders empty list when no messages", () => {
    renderHistory([]);

    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  describe("animations", () => {
    const item = (text: string) => screen.getByText(text).closest("li");

    it("fades in top-level messages on mount, not their replies", () => {
      renderHistory([message("1", "Parent", [message("2", "Nested")])]);

      expect(item("Parent")).toHaveAttribute("data-motion", "appear");
      expect(item("Nested")).not.toHaveAttribute("data-motion");
    });

    it("slides in the first reply to a message", () => {
      const { update } = renderHistory([message("1", "Parent")]);

      update([message("1", "Parent", [message("2", "Message 2")])]);

      expect(item("Message 2")).toHaveAttribute("data-motion", "enter");
    });

    it("keeps the last reply to a message where it was until it slides out", async () => {
      const finished = Promise.withResolvers<Animation>();
      const slide = { finished: finished.promise, playState: "running" };
      vi.spyOn(HTMLElement.prototype, "getAnimations").mockReturnValue([
        slide as Animation,
      ]);
      const { update } = renderHistory([
        message("1", "Parent", [
          message("2", "Message 2"),
          message("3", "Message 3"),
        ]),
      ]);

      update([message("1", "Parent", [message("3", "Message 3")])]);
      const leaving = item("Message 2");
      expect(leaving).toHaveAttribute("data-motion", "leave");
      expect(leaving?.nextElementSibling).toBe(item("Message 3"));

      // Cancelled while another slide runs, it waits for that one.
      await act(async () =>
        finished.reject(new DOMException("", "AbortError")),
      );
      expect(leaving).toBeInTheDocument();

      slide.playState = "finished";
      await act(async () =>
        update([message("1", "Parent", [message("3", "Message 3")])]),
      );
      expect(leaving).not.toBeInTheDocument();
    });

    it("keeps messages that leave one after another in order", () => {
      vi.spyOn(HTMLElement.prototype, "getAnimations").mockReturnValue([
        { finished: new Promise(() => {}) } as Animation,
      ]);
      const { update } = renderHistory([
        message("1", "Message 1"),
        message("2", "Message 2"),
        message("3", "Message 3"),
      ]);

      update([message("1", "Message 1"), message("3", "Message 3")]);
      update([message("3", "Message 3")]);

      expect(
        screen
          .getAllByRole("listitem", { hidden: true })
          .map((li) => li.dataset["motion"]),
      ).toEqual(["leave", "leave", "appear"]);
      expect(item("Message 1")?.nextElementSibling).toBe(item("Message 2"));
      expect(item("Message 2")).toHaveAttribute("inert");
    });

    it("removes a message at once without an animation to wait for", () => {
      const { update } = renderHistory([
        message("1", "Parent", [message("2", "Message 2")]),
      ]);

      update([message("1", "Parent")]);

      expect(screen.queryByText("Message 2")).not.toBeInTheDocument();
    });

    it("slides a message back in when it returns while leaving", () => {
      vi.spyOn(HTMLElement.prototype, "getAnimations").mockReturnValue([
        { finished: new Promise(() => {}) } as Animation,
      ]);
      const { update } = renderHistory([message("1", "Message 1")]);

      update([]);
      update([message("1", "Message 1")]);

      expect(item("Message 1")).toHaveAttribute("data-motion", "enter");
    });
  });

  describe("keyboard navigation", () => {
    const messages = [
      message("1", "First", [message("2", "A reply")]),
      message("3", "Last"),
    ];

    const article = (content: string) =>
      screen.getByText(content).closest("article")!;

    it("makes the bottom message the only tab stop", async () => {
      const user = userEvent.setup();
      renderHistory(messages);

      await user.tab();
      expect(article("Last")).toHaveFocus();

      await user.tab();
      expect(
        within(article("Last")).getByRole("button", { name: "Reply" }),
      ).toHaveFocus();
      await user.tab();
      await user.tab();
      expect(document.body).toHaveFocus();
    });

    it("moves between messages and replies with arrow keys, Home and End", async () => {
      const user = userEvent.setup();
      renderHistory(messages);

      await user.tab();
      await user.keyboard("{ArrowUp}");
      expect(article("A reply")).toHaveFocus();
      await user.keyboard("{ArrowUp}");
      expect(article("First")).toHaveFocus();
      await user.keyboard("{End}");
      expect(article("Last")).toHaveFocus();
      await user.keyboard("{Home}");
      expect(article("First")).toHaveFocus();
      await user.keyboard("{ArrowDown}");
      expect(article("A reply")).toHaveFocus();
    });

    it("leaves arrow keys to the controls inside a message", async () => {
      const user = userEvent.setup();
      renderHistory(messages);

      await user.tab();
      await user.tab();
      await user.keyboard("{ArrowUp}");
      expect(
        within(article("Last")).getByRole("button", { name: "Reply" }),
      ).toHaveFocus();
    });

    it("takes links and spoilers in other messages out of the tab order", () => {
      renderHistory([
        message("1", "[First](https://example.com) ||secret||"),
        message("3", "[Last](https://example.com) ||secret||"),
      ]);
      const spoiler = (content: string) =>
        within(article(content)).getByRole("button", { name: "Spoiler" });

      expect(screen.getByRole("link", { name: "First" })).toHaveAttribute(
        "tabindex",
        "-1",
      );
      expect(spoiler("First")).toHaveAttribute("tabindex", "-1");
      expect(screen.getByRole("link", { name: "Last" })).not.toHaveAttribute(
        "tabindex",
      );
      expect(spoiler("Last")).toHaveAttribute("tabindex", "0");
    });

    it("moves the controls' tab order with the tab stop", async () => {
      const user = userEvent.setup();
      renderHistory(messages);
      const reply = (content: string) =>
        within(article(content)).getByRole("button", { name: "Reply" });

      await user.tab();
      await user.keyboard("{ArrowUp}");
      await waitFor(() =>
        expect(reply("Last")).toHaveAttribute("tabindex", "-1"),
      );
      expect(reply("A reply")).not.toHaveAttribute("tabindex");

      await user.keyboard("{ArrowDown}");
      await waitFor(() =>
        expect(reply("Last")).not.toHaveAttribute("tabindex"),
      );
      expect(reply("A reply")).toHaveAttribute("tabindex", "-1");
    });

    it("keeps the tab stop on the message last focused", async () => {
      const user = userEvent.setup();
      renderHistory(messages);

      await user.click(
        within(article("First")).getByRole("button", { name: "Reply" }),
      );
      expect(article("First")).toHaveAttribute("tabindex", "0");
      expect(article("Last")).toHaveAttribute("tabindex", "-1");

      await user.tab({ shift: true });
      expect(article("First")).toHaveFocus();
    });

    it("falls back to the bottom message when the tab stop is removed", async () => {
      const user = userEvent.setup();
      const { update } = renderHistory(messages);

      await user.tab();
      await user.keyboard("{ArrowUp}");
      update([message("1", "First"), message("3", "Last")]);

      expect(article("Last")).toHaveAttribute("tabindex", "0");
    });

    it("takes controls added to other messages out of the tab order", async () => {
      const { update } = renderHistory(messages);

      update([
        createMessage({
          id: "1",
          content: "First",
          reactions: [{ emoji: "👍", count: 1, users: [] }],
        }),
        message("3", "Last"),
      ]);

      await waitFor(() =>
        expect(
          within(article("First")).getByRole("button", { name: /👍/ }),
        ).toHaveAttribute("tabindex", "-1"),
      );
    });
  });
});
