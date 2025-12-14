import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ChatHistoryResult } from "@/actions/chat";

import { Chat } from "./Chat";

vi.mock(import("./ChatHistory"), () => ({
  ChatHistory: () => <div data-testid="chat-history" />,
}));

vi.mock(import("./ChatInput"), () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));

describe("Chat", () => {
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
    expect(screen.queryByTestId("chat-history")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-input")).not.toBeInTheDocument();
  });

  it("renders ChatHistory and ChatInput on success", async () => {
    const successResult: ChatHistoryResult = { status: "ok", messages: [] };

    await act(async () =>
      render(<Chat history={Promise.resolve(successResult)} />),
    );

    expect(screen.getByTestId("chat-history")).toBeInTheDocument();
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
  });
});
