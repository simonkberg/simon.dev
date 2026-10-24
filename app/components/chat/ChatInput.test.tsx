import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { postChatMessage, type PostChatMessageResult } from "@/actions/chat";
import { renderChatInput } from "@/mocks/chatInput";
import { resetPreferences } from "@/mocks/preferences";

vi.mock(import("@/actions/chat"), () => ({ postChatMessage: vi.fn() }));

const sentForm = () => vi.mocked(postChatMessage).mock.calls[0]?.[0];

beforeEach(() => {
  vi.mocked(postChatMessage).mockResolvedValue({ status: "ok" });
});

describe("ChatInput", () => {
  it("renders input field with correct attributes", () => {
    const { input } = renderChatInput();

    expect(input).toHaveAttribute("name", "text");
    expect(input).toHaveAttribute("placeholder", "Write a message...");
    expect(input).toBeEnabled();
  });

  it("disables input while form is submitting", async () => {
    const { promise, resolve } = Promise.withResolvers<PostChatMessageResult>();
    vi.mocked(postChatMessage).mockReturnValue(promise);
    const { input, send } = renderChatInput();

    await send("Hello");

    expect(input).toBeDisabled();

    resolve({ status: "ok" });

    await waitFor(() => {
      expect(input).toBeEnabled();
    });
  });

  it("does not submit when input is empty", async () => {
    const { user, input } = renderChatInput();

    await user.click(input);
    await user.keyboard("{Enter}");

    expect(postChatMessage).not.toHaveBeenCalled();
  });

  it("does not submit when input is only whitespace", async () => {
    const { send } = renderChatInput();

    await send("   ");

    expect(postChatMessage).not.toHaveBeenCalled();
  });

  it("clears input and focuses it after successful submission", async () => {
    const { user, input } = renderChatInput();

    await user.type(input, "Test message");
    expect(input).toHaveValue("Test message");

    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(input).toHaveValue("");
    });
    expect(input).toHaveFocus();
  });

  it("preserves input and focuses it after failed submission", async () => {
    vi.mocked(postChatMessage).mockResolvedValue({
      status: "error",
      error: "Rate limit exceeded",
    });
    const { input, send } = renderChatInput();

    await send("Test message");
    await screen.findByText("Rate limit exceeded");

    expect(input).toHaveValue("Test message");
    expect(input).toHaveFocus();
  });

  describe("ChatToast integration", () => {
    it("does not show toast on successful submission", async () => {
      const { send } = renderChatInput();

      await send("Test");

      await waitFor(() => expect(postChatMessage).toHaveBeenCalled());
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("passes error message and error variant to toast on failure", async () => {
      vi.mocked(postChatMessage).mockResolvedValue({
        status: "error",
        error: "Rate limited",
      });
      const { send } = renderChatInput();

      await send("Test");

      const toast = await screen.findByRole("status");
      expect(toast).toHaveTextContent("Rate limited");
      expect(toast).toHaveClass("error");
    });

    it("clears toast message on successful submission after error", async () => {
      vi.mocked(postChatMessage).mockResolvedValueOnce({
        status: "error",
        error: "Failed",
      });
      const { send } = renderChatInput();

      await send("First");
      await screen.findByRole("status");

      await send("Second");

      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument(),
      );
    });
  });

  describe("reply mode", () => {
    it("shows 'Write a reply...' placeholder when replying", () => {
      const { input } = renderChatInput("some-message-id");

      expect(input).toHaveAttribute("placeholder", "Write a reply...");
    });

    it("focuses input when replyToId changes to non-null", () => {
      const { input, replyTo } = renderChatInput();
      expect(input).not.toHaveFocus();

      replyTo("message-id");

      expect(input).toHaveFocus();
    });

    it("clears replyToId when Escape key is pressed while replying", async () => {
      const { user, setReplyToId } = renderChatInput("message-id");

      await user.keyboard("{Escape}");

      expect(setReplyToId).toHaveBeenCalledWith(null);
    });

    it("leaves the reply when a tooltip takes the Escape", () => {
      const { setReplyToId } = renderChatInput("message-id");
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
      });
      event.preventDefault();
      window.dispatchEvent(event);

      expect(setReplyToId).not.toHaveBeenCalled();
    });

    it("does not call setReplyToId on Escape when not replying", async () => {
      const { user, setReplyToId } = renderChatInput();

      await user.keyboard("{Escape}");

      expect(setReplyToId).not.toHaveBeenCalled();
    });

    it("includes replyToId in form data when replying", async () => {
      const { send } = renderChatInput("reply-target-id");

      await send("Reply text");

      await waitFor(() => {
        expect(postChatMessage).toHaveBeenCalled();
      });
      expect(sentForm()?.get("text")).toBe("Reply text");
      expect(sentForm()?.get("replyToId")).toBe("reply-target-id");
    });

    it("does not include replyToId in form data when not replying", async () => {
      const { send } = renderChatInput();

      await send("Normal message");

      expect(sentForm()?.get("text")).toBe("Normal message");
      expect(sentForm()?.get("replyToId")).toBeNull();
    });

    it("clears replyToId on successful submission", async () => {
      const { send, setReplyToId } = renderChatInput("message-id");

      await send("Reply");

      await waitFor(() => {
        expect(setReplyToId).toHaveBeenCalledWith(null);
      });
    });

    it("preserves replyToId on failed submission", async () => {
      vi.mocked(postChatMessage).mockResolvedValue({
        status: "error",
        error: "Failed",
      });
      const { send, setReplyToId } = renderChatInput("message-id");

      await send("Reply");
      await screen.findByText("Failed");

      expect(setReplyToId).not.toHaveBeenCalled();
    });
  });
});

describe("CaretBuddy integration", () => {
  it("shows typing state during active input", async () => {
    const { user, input } = renderChatInput();

    await user.type(input, "H");

    expect(screen.getByText("(°▽°)")).toBeInTheDocument();
  });

  it("shows thinking state while message is pending", async () => {
    vi.mocked(postChatMessage).mockReturnValue(
      Promise.withResolvers<PostChatMessageResult>().promise,
    );
    const { send } = renderChatInput();

    await send("Hello");

    expect(screen.getByText("(・・?)")).toBeInTheDocument();
  });

  it("shows error state on failed submission", async () => {
    vi.mocked(postChatMessage).mockResolvedValue({
      status: "error",
      error: "Failed",
    });
    const { send } = renderChatInput();

    await send("Hello");

    expect(await screen.findByText("(╥_╥)")).toBeInTheDocument();
  });

  it("shows success state briefly after successful submission", async () => {
    const { send } = renderChatInput();

    await send("Hello");

    expect(await screen.findByText("(＾▽＾)")).toBeInTheDocument();
  });

  describe("commands", () => {
    afterEach(resetPreferences);

    it("prints a command's output without posting, until Escape", async () => {
      const { user, input, send } = renderChatInput();

      await send("/help");

      const output = screen.getByRole("status");
      expect(output).toHaveTextContent("/help");
      expect(output).toHaveTextContent("List the commands");
      expect(input).toHaveValue("");
      expect(postChatMessage).not.toHaveBeenCalled();

      await user.keyboard("{Escape}");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("clears the output once a message is sent", async () => {
      const { send } = renderChatInput();

      await send("/help");
      await send("Hello");

      expect(postChatMessage).toHaveBeenCalled();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("runs a command that prints nothing", async () => {
      const { input, send } = renderChatInput();

      await send("/style ledger ");

      expect(document.documentElement).toHaveAttribute(
        "data-variant",
        "ledger",
      );
      expect(input).toHaveValue("");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("keeps the text of a command that fails and shows why", async () => {
      const { input, send } = renderChatInput();

      await send("/nope");

      expect(await screen.findByRole("status")).toHaveTextContent(
        "Unknown command /nope. Try /help.",
      );
      expect(input).toHaveValue("/nope");
      expect(postChatMessage).not.toHaveBeenCalled();
    });

    it("sends a doubled slash as one", async () => {
      const { send } = renderChatInput();

      await send("//shrug");

      expect(sentForm()?.get("text")).toBe("/shrug");
    });
  });
});
