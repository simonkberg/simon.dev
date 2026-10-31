import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { postChatMessage, type PostChatMessageResult } from "@/actions/chat";
import { forgetMe, type ForgetMeResult } from "@/actions/simonBot";

import { ChatInput } from "./ChatInput";

vi.mock(import("@/actions/chat"), () => ({ postChatMessage: vi.fn() }));
vi.mock(import("@/actions/simonBot"), () => ({
  forgetMe: vi.fn(),
  getNotesOnMe: vi.fn(),
}));

function renderChatInput(replyToId: string | null = null) {
  const onCancelReply = vi.fn();
  const user = userEvent.setup({ delay: null });
  const element = (replyToId: string | null) => (
    <ChatInput replyToId={replyToId} onCancelReply={onCancelReply}>
      <button type="button">Next</button>
    </ChatInput>
  );
  const view = render(element(replyToId));
  const input = screen.getByRole<HTMLInputElement>("combobox");

  return {
    user,
    input,
    onCancelReply,
    replyTo: (replyToId: string | null) => view.rerender(element(replyToId)),
    send: async (text: string) => {
      await user.type(input, text);
      await user.keyboard("{Enter}");
    },
  };
}

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
      const { user, onCancelReply } = renderChatInput("message-id");

      await user.keyboard("{Escape}");

      expect(onCancelReply).toHaveBeenCalled();
    });

    it("leaves the reply when a tooltip takes the Escape", () => {
      const { onCancelReply } = renderChatInput("message-id");
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
      });
      event.preventDefault();
      window.dispatchEvent(event);

      expect(onCancelReply).not.toHaveBeenCalled();
    });

    it("leaves the reply when Escape closes the suggestions", async () => {
      const { user, input, onCancelReply } = renderChatInput("message-id");

      await user.type(input, ":");
      await screen.findByRole("listbox");
      await user.keyboard("{Escape}");

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(onCancelReply).not.toHaveBeenCalled();
    });

    it("does not cancel a reply on Escape when not replying", async () => {
      const { user, onCancelReply } = renderChatInput();

      await user.keyboard("{Escape}");

      expect(onCancelReply).not.toHaveBeenCalled();
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
      const { send, onCancelReply } = renderChatInput("message-id");

      await send("Reply");

      await waitFor(() => {
        expect(onCancelReply).toHaveBeenCalled();
      });
    });

    it("preserves replyToId on failed submission", async () => {
      vi.mocked(postChatMessage).mockResolvedValue({
        status: "error",
        error: "Failed",
      });
      const { send, onCancelReply } = renderChatInput("message-id");

      await send("Reply");
      await screen.findByText("Failed");

      expect(onCancelReply).not.toHaveBeenCalled();
    });
  });
});

describe("CaretBuddy integration", () => {
  it("shows typing state during active input", async () => {
    const { user, input } = renderChatInput();

    await user.type(input, "H");

    expect(screen.getByText("(•▽•)")).toBeInTheDocument();
  });

  it("shows thinking state while message is pending", async () => {
    const { promise, resolve } = Promise.withResolvers<PostChatMessageResult>();
    vi.mocked(postChatMessage).mockReturnValue(promise);
    // React holds every later transition until this one's action settles.
    onTestFinished(() => resolve({ status: "ok" }));
    const { send } = renderChatInput();

    await send("Hello");

    expect(screen.getByText("(• •?)")).toBeInTheDocument();
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

    expect(await screen.findByText("(^ᵥ^)")).toBeInTheDocument();
  });

  describe("commands", () => {
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

      await send("/help");
      await user.click(screen.getByRole("button", { name: "Close output" }));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("waits for a command that runs on the server", async () => {
      const { promise, resolve } = Promise.withResolvers<ForgetMeResult>();
      vi.mocked(forgetMe).mockReturnValue(promise);
      const { input, send } = renderChatInput();

      await send("/forget");
      expect(input).toBeDisabled();

      resolve({ status: "ok", data: { forgotten: 0 } });

      expect(await screen.findByRole("status")).toHaveTextContent(
        "simon-bot had nothing to forget about you.",
      );
      expect(input).toHaveValue("");
      expect(input).toHaveFocus();
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

      await send("/Style Ledger ");

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
        "Unknown command /nope. Try /help, or // to send a slash.",
      );
      expect(input).toHaveValue("/nope");
      expect(postChatMessage).not.toHaveBeenCalled();
    });

    it("shows a repeated command error again", async () => {
      const { user, input, send } = renderChatInput();

      await send("/nope");
      await user.click(
        await screen.findByRole("button", { name: "Close notification" }),
      );
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument(),
      );
      await user.type(input, "{Enter}");

      expect(await screen.findByRole("status")).toHaveTextContent(
        "Unknown command /nope.",
      );
    });

    it("sends a doubled slash as one", async () => {
      const { send } = renderChatInput();

      await send("//shrug");

      expect(sentForm()?.get("text")).toBe("/shrug");
    });
  });
});

describe("typing", () => {
  // The methods of the typing requests sent. A spy rather than MSW, so a late ping from the previous test can't land here.
  function recordTyping() {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    return () =>
      fetch.mock.calls
        .filter(([url]) => url === "/api/chat/typing")
        .map(([, init]) => init?.method);
  }

  it("pings at most every 2s while a message is typed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const typing = recordTyping();
    const { user, input } = renderChatInput();

    await user.type(input, "Hel");
    vi.setSystemTime(Date.now() + 2_000);
    await user.type(input, "lo{Enter}");

    expect(typing()).toEqual(["POST", "POST"]);
  });

  it("pings at once for the next message after one is sent", async () => {
    const typing = recordTyping();
    const { user, input } = renderChatInput();

    await user.type(input, "Hi{Enter}");
    await waitFor(() => expect(input).toHaveValue(""));
    await user.type(input, "Yo");

    expect(typing()).toEqual(["POST", "POST"]);
  });

  it("doesn't ping for a command", async () => {
    const typing = recordTyping();
    const { user, input } = renderChatInput();

    await user.type(input, "/help");
    await user.clear(input);

    expect(typing()).toEqual([]);
  });

  it("stops once when the draft is cleared", async () => {
    const typing = recordTyping();
    const { user, input } = renderChatInput();

    await user.type(input, "Hi");
    await user.clear(input);
    await user.type(input, " ");
    await user.clear(input);

    expect(typing()).toEqual(["POST", "DELETE"]);
  });

  it("sends the stop only once the ping it ends has landed", async () => {
    const { promise, resolve } = Promise.withResolvers<Response>();
    const typing = recordTyping();
    vi.mocked(fetch).mockReturnValueOnce(promise);
    const { user, input } = renderChatInput();

    await user.type(input, "H");
    await user.clear(input);
    expect(typing()).toEqual(["POST"]);

    resolve(new Response(null, { status: 204 }));
    await waitFor(() => expect(typing()).toEqual(["POST", "DELETE"]));
  });
});
