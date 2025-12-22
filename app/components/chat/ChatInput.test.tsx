import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { postChatMessage, type PostChatMessageResult } from "@/actions/chat";

import type { BuddyState } from "./CaretBuddy";
import { ChatInput } from "./ChatInput";

vi.mock(import("@/actions/chat"), () => ({ postChatMessage: vi.fn() }));

describe("ChatInput", () => {
  const defaultReplyProps = { replyToId: null, setReplyToId: vi.fn() };

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("renders input field with correct attributes", () => {
    render(<ChatInput {...defaultReplyProps} />);
    const input = screen.getByRole("textbox");

    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("name", "text");
    expect(input).toHaveAttribute("placeholder", "Write a message...");
  });

  it("input is not disabled initially", () => {
    render(<ChatInput {...defaultReplyProps} />);
    const input = screen.getByRole("textbox");

    expect(input).not.toBeDisabled();
  });

  it("disables input while form is submitting", async () => {
    const user = userEvent.setup({ delay: null });
    const { promise, resolve } = Promise.withResolvers<PostChatMessageResult>();

    vi.mocked(postChatMessage).mockReturnValue(promise);

    render(<ChatInput {...defaultReplyProps} />);
    const input = screen.getByRole("textbox");

    await user.type(input, "Hello");
    await user.keyboard("{Enter}");

    expect(input).toBeDisabled();

    resolve({ status: "ok" });

    await waitFor(() => {
      expect(input).toBeEnabled();
    });
  });

  it("calls postChatMessage when form is submitted", async () => {
    const user = userEvent.setup({ delay: null });

    vi.mocked(postChatMessage).mockResolvedValue({ status: "ok" });

    render(<ChatInput {...defaultReplyProps} />);
    const input = screen.getByRole("textbox");

    await user.type(input, "Test message");
    await user.keyboard("{Enter}");

    expect(postChatMessage).toHaveBeenCalled();
  });

  it("clears input and focuses it after successful submission", async () => {
    const user = userEvent.setup({ delay: null });

    vi.mocked(postChatMessage).mockResolvedValue({ status: "ok" });

    render(<ChatInput {...defaultReplyProps} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;

    await user.type(input, "Test message");
    expect(input.value).toBe("Test message");

    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(input.value).toBe("");
    });
    expect(input).toHaveFocus();
  });

  it("preserves input and focuses it after failed submission", async () => {
    const user = userEvent.setup({ delay: null });

    vi.mocked(postChatMessage).mockResolvedValue({
      status: "error",
      error: "Rate limit exceeded",
    });

    render(<ChatInput {...defaultReplyProps} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;

    await user.type(input, "Test message");
    expect(input.value).toBe("Test message");

    await user.keyboard("{Enter}");

    expect(await screen.findByText("Rate limit exceeded")).toBeInTheDocument();

    // Input value should be preserved on error
    expect(input.value).toBe("Test message");
    expect(input).toHaveFocus();
  });

  describe("ChatToast integration", () => {
    it("does not show toast initially", () => {
      render(<ChatInput {...defaultReplyProps} />);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("does not show toast on successful submission", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(postChatMessage).mockResolvedValue({ status: "ok" });

      render(<ChatInput {...defaultReplyProps} />);
      await user.type(screen.getByRole("textbox"), "Test");
      await user.keyboard("{Enter}");

      await waitFor(() => expect(postChatMessage).toHaveBeenCalled());
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("passes error message and error variant to toast on failure", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(postChatMessage).mockResolvedValue({
        status: "error",
        error: "Rate limited",
      });

      render(<ChatInput {...defaultReplyProps} />);
      await user.type(screen.getByRole("textbox"), "Test");
      await user.keyboard("{Enter}");

      const toast = await screen.findByRole("status");
      expect(toast).toHaveTextContent("Rate limited");
      expect(toast).toHaveClass("error");
    });

    it("clears toast message on successful submission after error", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(postChatMessage)
        .mockResolvedValueOnce({ status: "error", error: "Failed" })
        .mockResolvedValueOnce({ status: "ok" });

      render(<ChatInput {...defaultReplyProps} />);
      const input = screen.getByRole("textbox");

      await user.type(input, "First");
      await user.keyboard("{Enter}");
      await screen.findByRole("status");

      await user.type(input, "Second");
      await user.keyboard("{Enter}");

      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument(),
      );
    });
  });

  describe("reply mode", () => {
    it("shows 'Write a reply...' placeholder when replying", () => {
      render(<ChatInput replyToId="some-message-id" setReplyToId={vi.fn()} />);
      const input = screen.getByRole("textbox");

      expect(input).toHaveAttribute("placeholder", "Write a reply...");
    });

    it("focuses input when replyToId changes to non-null", () => {
      const { rerender } = render(
        <ChatInput replyToId={null} setReplyToId={vi.fn()} />,
      );

      const input = screen.getByRole("textbox");
      expect(input).not.toHaveFocus();

      rerender(<ChatInput replyToId="message-id" setReplyToId={vi.fn()} />);

      expect(input).toHaveFocus();
    });

    it("clears replyToId when Escape key is pressed while replying", async () => {
      const user = userEvent.setup({ delay: null });
      const setReplyToId = vi.fn();

      render(<ChatInput replyToId="message-id" setReplyToId={setReplyToId} />);

      await user.keyboard("{Escape}");

      expect(setReplyToId).toHaveBeenCalledWith(null);
    });

    it("does not call setReplyToId on Escape when not replying", async () => {
      const user = userEvent.setup({ delay: null });
      const setReplyToId = vi.fn();

      render(<ChatInput replyToId={null} setReplyToId={setReplyToId} />);

      await user.keyboard("{Escape}");

      expect(setReplyToId).not.toHaveBeenCalled();
    });

    it("includes replyToId in form data when replying", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(postChatMessage).mockResolvedValue({ status: "ok" });

      render(<ChatInput replyToId="reply-target-id" setReplyToId={vi.fn()} />);

      await user.type(screen.getByRole("textbox"), "Reply text");
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(postChatMessage).toHaveBeenCalled();
      });

      const formData = vi.mocked(postChatMessage).mock
        .calls[0]?.[0] as FormData;
      expect(formData.get("text")).toBe("Reply text");
      expect(formData.get("replyToId")).toBe("reply-target-id");
    });

    it("does not include replyToId in form data when not replying", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(postChatMessage).mockResolvedValue({ status: "ok" });

      render(<ChatInput replyToId={null} setReplyToId={vi.fn()} />);

      await user.type(screen.getByRole("textbox"), "Normal message");
      await user.keyboard("{Enter}");

      const formData = vi.mocked(postChatMessage).mock
        .calls[0]?.[0] as FormData;
      expect(formData.get("replyToId")).toBeNull();
    });

    it("clears replyToId on successful submission", async () => {
      const user = userEvent.setup({ delay: null });
      const setReplyToId = vi.fn();
      vi.mocked(postChatMessage).mockResolvedValue({ status: "ok" });

      render(<ChatInput replyToId="message-id" setReplyToId={setReplyToId} />);

      await user.type(screen.getByRole("textbox"), "Reply");
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(setReplyToId).toHaveBeenCalledWith(null);
      });
    });

    it("preserves replyToId on failed submission", async () => {
      const user = userEvent.setup({ delay: null });
      const setReplyToId = vi.fn();
      vi.mocked(postChatMessage).mockResolvedValue({
        status: "error",
        error: "Failed",
      });

      render(<ChatInput replyToId="message-id" setReplyToId={setReplyToId} />);

      await user.type(screen.getByRole("textbox"), "Reply");
      await user.keyboard("{Enter}");

      await screen.findByText("Failed");

      // setReplyToId should only be called from Escape handler, not from error
      expect(setReplyToId).not.toHaveBeenCalledWith(null);
    });
  });
});

// Helper to get buddy state from rendered text
const getBuddyExpression = () => {
  const expressions: Record<string, BuddyState> = {
    // idle - breathing cycle with Z wave
    "(-_-)zzz": "idle",
    "(-_-)Zzz": "idle",
    "(-_-)zZz": "idle",
    "(-_-)zzZ": "idle",
    "(-_-)...": "idle",
    "(-o-)...": "idle",
    "(-O-)...": "idle",
    // other states
    "(°▽°)": "typing",
    "(・・?)": "thinking",
    "(⌐■_■)": "code",
    "(°o°)": "long",
    "(╥_╥)": "error",
    "(＾▽＾)": "success",
  };

  for (const [expr, state] of Object.entries(expressions)) {
    if (screen.queryByText(expr)) return state;
  }
  return null;
};

describe("CaretBuddy integration", () => {
  const defaultReplyProps = { replyToId: null, setReplyToId: vi.fn() };

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows idle state when input is empty and no recent activity", async () => {
    render(<ChatInput {...defaultReplyProps} />);

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });

    expect(getBuddyExpression()).toBe("idle");
  });

  it("shows typing state during active input", async () => {
    const user = userEvent.setup({
      delay: null,
      advanceTimers: vi.advanceTimersByTime,
    });

    render(<ChatInput {...defaultReplyProps} />);
    const input = screen.getByRole("textbox");

    await user.type(input, "H");

    expect(getBuddyExpression()).toBe("typing");
  });

  it("shows code state when backticks are present", async () => {
    const user = userEvent.setup({
      delay: null,
      advanceTimers: vi.advanceTimersByTime,
    });

    render(<ChatInput {...defaultReplyProps} />);
    const input = screen.getByRole("textbox");

    await user.type(input, "Check this `code`");

    expect(getBuddyExpression()).toBe("code");
  });

  it("shows long state when input exceeds 100 characters", async () => {
    const user = userEvent.setup({
      delay: null,
      advanceTimers: vi.advanceTimersByTime,
    });

    render(<ChatInput {...defaultReplyProps} />);
    const input = screen.getByRole("textbox");

    const longText = "a".repeat(101);
    await user.type(input, longText);

    expect(getBuddyExpression()).toBe("long");
  });

  it("shows thinking state while message is pending", async () => {
    const user = userEvent.setup({
      delay: null,
      advanceTimers: vi.advanceTimersByTime,
    });
    const { promise } = Promise.withResolvers<PostChatMessageResult>();

    vi.mocked(postChatMessage).mockReturnValue(promise);

    render(<ChatInput {...defaultReplyProps} />);
    const input = screen.getByRole("textbox");

    await user.type(input, "Hello");
    await user.keyboard("{Enter}");

    expect(getBuddyExpression()).toBe("thinking");
  });

  it("shows error state on failed submission", async () => {
    const user = userEvent.setup({
      delay: null,
      advanceTimers: vi.advanceTimersByTime,
    });

    vi.mocked(postChatMessage).mockResolvedValue({
      status: "error",
      error: "Failed",
    });

    render(<ChatInput {...defaultReplyProps} />);
    const input = screen.getByRole("textbox");

    await user.type(input, "Hello");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(getBuddyExpression()).toBe("error");
    });
  });

  it("shows success state briefly after successful submission", async () => {
    const user = userEvent.setup({
      delay: null,
      advanceTimers: vi.advanceTimersByTime,
    });

    vi.mocked(postChatMessage).mockResolvedValue({ status: "ok" });

    render(<ChatInput {...defaultReplyProps} />);
    const input = screen.getByRole("textbox");

    await user.type(input, "Hello");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(getBuddyExpression()).toBe("success");
    });
  });
});
