import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { type ChatHistoryResult, reactToChatMessage } from "@/actions/chat";
import type { Message, Reaction } from "@/lib/discord/api";
import { createMessage } from "@/mocks/messages";
import { sendToggle } from "@/mocks/popover";

import { Chat } from "./Chat";
import { loadShortcodes } from "./shortcodes";

vi.mock(import("@/actions/chat"), () => ({ reactToChatMessage: vi.fn() }));
vi.mock(import("./shortcodes"), { spy: true });

describe("Chat", () => {
  const chatElement = (result: ChatHistoryResult, tipDismissed = false) => (
    <Chat
      history={Promise.resolve(result)}
      tipDismissed={Promise.resolve(tipDismissed)}
    />
  );

  const renderChat = (messages: Message[]) =>
    act(async () => render(chatElement({ status: "ok", messages })));

  it("loads the emoji shortcodes once it mounts", async () => {
    await renderChat([]);

    expect(loadShortcodes).toHaveBeenCalled();
  });

  it("renders the simon-bot tip until it is dismissed", async () => {
    await renderChat([]);

    expect(
      screen.getByRole("button", { name: "Dismiss tip" }),
    ).toBeInTheDocument();
  });

  it("hides the simon-bot tip once its cookie is set", async () => {
    document.cookie = "chatTipDismissed=true";
    await renderChat([]);

    expect(
      screen.queryByRole("button", { name: "Dismiss tip" }),
    ).not.toBeInTheDocument();
  });

  it("hides the simon-bot tip when only the server sees its cookie", async () => {
    await act(async () =>
      render(chatElement({ status: "ok", messages: [] }, true)),
    );

    expect(
      screen.queryByRole("button", { name: "Dismiss tip" }),
    ).not.toBeInTheDocument();
  });

  it("hides the simon-bot tip when the cookie is newer than the render", async () => {
    await renderChat([]);

    document.cookie = "chatTipDismissed=true";
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(
      screen.queryByRole("button", { name: "Dismiss tip" }),
    ).not.toBeInTheDocument();
  });

  it("displays error message when result status is error", async () => {
    await act(async () =>
      render(chatElement({ status: "error", error: "Failed to fetch" })),
    );

    expect(
      screen.getByText("Chat is temporarily unavailable :("),
    ).toBeInTheDocument();
  });

  it("renders messages on success", async () => {
    await renderChat([createMessage({ content: "Hello world" })]);

    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  describe("reply flow", () => {
    it("shows reply preview for nested message", async () => {
      const user = userEvent.setup();
      await renderChat([
        createMessage({
          id: "100",
          content: "Parent message",
          replies: [createMessage({ id: "200", content: "Nested reply" })],
        }),
      ]);

      const replyButtons = screen.getAllByRole("button", { name: "Reply" });
      await user.click(replyButtons[1]!);

      expect(screen.getByText("Replying to")).toBeInTheDocument();
    });

    it("shows and clears the reply preview", async () => {
      const user = userEvent.setup();
      await renderChat([createMessage({ id: "100" })]);
      expect(screen.queryByText("Replying to")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Reply" }));
      expect(screen.getByText("Replying to")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Clear reply" }));
      expect(screen.queryByText("Replying to")).not.toBeInTheDocument();
    });

    it("drops the reply when its message leaves the history", async () => {
      const user = userEvent.setup();
      const history = (...ids: string[]): ChatHistoryResult => ({
        status: "ok",
        messages: ids.map((id) => createMessage({ id, content: id })),
      });
      const { rerender } = await act(async () =>
        render(chatElement(history("200", "300"))),
      );
      await user.click(screen.getAllByRole("button", { name: "Reply" })[0]!);
      expect(screen.getByText("Replying to")).toBeInTheDocument();

      await act(async () => rerender(chatElement(history("300", "400"))));

      expect(screen.queryByText("Replying to")).not.toBeInTheDocument();
      expect(screen.getByPlaceholderText("Write a message...")).toBeVisible();
    });
  });

  describe("reactions", () => {
    const thumbs: Reaction[] = [{ emoji: "👍", count: 1, users: [] }];

    // React holds every transition until all pending actions settle, so each test settles its own.
    function holdReaction() {
      const { promise, resolve } =
        Promise.withResolvers<Awaited<ReturnType<typeof reactToChatMessage>>>();
      vi.mocked(reactToChatMessage).mockReturnValue(promise);
      return () => act(async () => resolve({ status: "ok" }));
    }

    it("shows a reaction at once while the server catches up", async () => {
      const settle = holdReaction();
      await renderChat([
        createMessage({
          reactions: [...thumbs, { emoji: "🎉", count: 1, users: [] }],
        }),
      ]);

      // Awaited in act: the click's hover shows the pill's tooltip, whose shortcode loads.
      await act(() =>
        userEvent.click(screen.getByRole("button", { name: "👍 1" })),
      );

      const pill = screen.getByRole("button", { name: "👍 2" });
      expect(pill).toHaveAttribute("aria-pressed", "true");
      expect(pill).toHaveAccessibleDescription(
        /reacted by you and 1 on Discord$/,
      );
      expect(screen.getByRole("button", { name: "🎉 1" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await settle();
    });

    it("drops a pill at once when the last reaction is taken back", async () => {
      const settle = holdReaction();
      await renderChat([
        createMessage({
          reactions: [{ emoji: "👍", count: 1, users: [], mine: true }],
        }),
      ]);

      await userEvent.click(screen.getByRole("button", { name: "👍 1" }));

      expect(
        screen.queryByRole("button", { name: /👍/ }),
      ).not.toBeInTheDocument();
      await settle();
    });

    it("swaps the visitor's tone at once when they pick another", async () => {
      const settle = holdReaction();
      await renderChat([
        createMessage({
          reactions: [
            { emoji: "👍🏽", count: 1, users: [], mine: true },
            ...thumbs,
          ],
        }),
      ]);

      const picker = screen.getByRole("toolbar", {
        name: "Pick a reaction",
        hidden: true,
      });
      sendToggle(picker, "beforetoggle", "open");
      await userEvent.click(
        within(picker).getByRole("button", { name: "thumbsup", hidden: true }),
      );

      expect(reactToChatMessage).toHaveBeenCalledWith("msg-1", "👍");
      expect(screen.getByRole("button", { name: "👍 2" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await settle();
    });

    it("shows a reply's new reaction at once", async () => {
      const settle = holdReaction();
      await renderChat([
        createMessage({
          replies: [createMessage({ id: "reply-1", content: "Reply" })],
        }),
        createMessage({ id: "msg-2", content: "Untouched" }),
      ]);

      const picker = screen.getAllByRole("toolbar", {
        name: "Pick a reaction",
        hidden: true,
      })[1]!;
      sendToggle(picker, "beforetoggle", "open");
      await userEvent.click(
        within(picker).getByRole("button", { name: "tada", hidden: true }),
      );

      expect(reactToChatMessage).toHaveBeenCalledWith("reply-1", "🎉");
      expect(screen.getByRole("button", { name: "🎉 1" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await settle();
    });

    it("keeps other messages reactable while one reaction is pending", async () => {
      const settle = holdReaction();
      await renderChat([
        createMessage({ reactions: thumbs }),
        createMessage({ id: "msg-2", content: "Other" }),
      ]);

      await userEvent.click(screen.getByRole("button", { name: "👍 1" }));

      expect(screen.getByRole("button", { name: "👍 2" })).toBeDisabled();
      const [busy, free] = screen.getAllByRole("button", {
        name: "Add reaction",
      });
      expect(busy).toBeDisabled();
      expect(free).toBeEnabled();
      await settle();
    });

    it.each([
      {
        failure: "the server turns it away",
        mock: () =>
          vi
            .mocked(reactToChatMessage)
            .mockResolvedValue({
              status: "error",
              error: "Rate limit exceeded.",
            }),
        error: "Rate limit exceeded.",
      },
      {
        failure: "the action itself fails",
        mock: () =>
          vi.mocked(reactToChatMessage).mockRejectedValue(new Error("offline")),
        error: "Failed to react to chat message",
      },
    ])(
      "puts the reaction back and says why when $failure",
      async ({ mock, error }) => {
        mock();
        await renderChat([createMessage({ reactions: thumbs })]);

        await userEvent.click(screen.getByRole("button", { name: "👍 1" }));

        expect(await screen.findByText(error)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "👍 1" })).toHaveAttribute(
          "aria-pressed",
          "false",
        );
      },
    );

    it("shows the same error again on a repeated failure", async () => {
      vi.mocked(reactToChatMessage).mockResolvedValue({
        status: "error",
        error: "Rate limit exceeded.",
      });
      await renderChat([createMessage({ reactions: thumbs })]);

      const pill = screen.getByRole("button", { name: "👍 1" });
      await userEvent.click(pill);
      await userEvent.click(
        await screen.findByRole("button", { name: "Close notification" }),
      );
      await waitFor(() =>
        expect(
          screen.queryByText("Rate limit exceeded."),
        ).not.toBeInTheDocument(),
      );
      await userEvent.click(pill);

      expect(
        await screen.findByText("Rate limit exceeded."),
      ).toBeInTheDocument();
    });
  });
});
