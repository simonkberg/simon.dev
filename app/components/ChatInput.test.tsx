import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { postChatMessage, type PostChatMessageResult } from "@/actions/chat";

import { ChatInput } from "./ChatInput";

vi.mock(import("@/actions/chat"), () => ({ postChatMessage: vi.fn() }));

describe("ChatInput", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders input field with correct attributes", () => {
    render(<ChatInput />);
    const input = screen.getByRole("textbox");

    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("name", "text");
    expect(input).toHaveAttribute("placeholder", "Write a message...");
  });

  it("input is not disabled initially", () => {
    render(<ChatInput />);
    const input = screen.getByRole("textbox");

    expect(input).not.toBeDisabled();
  });

  it("disables input while form is submitting", async () => {
    const user = userEvent.setup({ delay: null });
    const { promise, resolve } = Promise.withResolvers<PostChatMessageResult>();

    vi.mocked(postChatMessage).mockReturnValue(promise);

    render(<ChatInput />);
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

    render(<ChatInput />);
    const input = screen.getByRole("textbox");

    await user.type(input, "Test message");
    await user.keyboard("{Enter}");

    expect(postChatMessage).toHaveBeenCalled();
  });

  it("clears input and focuses it after successful submission", async () => {
    const user = userEvent.setup({ delay: null });

    vi.mocked(postChatMessage).mockResolvedValue({ status: "ok" });

    render(<ChatInput />);
    const input = screen.getByRole("textbox") as HTMLInputElement;

    await user.type(input, "Test message");
    expect(input.value).toBe("Test message");

    await user.keyboard("{Enter}");

    expect(input.value).toBe("");
    expect(input).toHaveFocus();
  });

  it("preserves input and focuses it after failed submission", async () => {
    const user = userEvent.setup({ delay: null });

    vi.mocked(postChatMessage).mockResolvedValue({
      status: "error",
      error: "Rate limit exceeded",
    });

    render(<ChatInput />);
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
      render(<ChatInput />);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("does not show toast on successful submission", async () => {
      const user = userEvent.setup({ delay: null });
      vi.mocked(postChatMessage).mockResolvedValue({ status: "ok" });

      render(<ChatInput />);
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

      render(<ChatInput />);
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

      render(<ChatInput />);
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
});
