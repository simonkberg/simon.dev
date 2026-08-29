import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { dismissChatTip } from "@/actions/chat";

import { ChatTip } from "./ChatTip";

vi.mock(import("@/actions/chat"), () => ({ dismissChatTip: vi.fn() }));

describe("ChatTip", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the tip", () => {
    render(<ChatTip />);

    expect(
      screen.getByText(/mention .simon bot. to chat with a clanker/),
    ).toBeInTheDocument();
  });

  it("marks the info glyph with a codepoint Iosevka actually covers", () => {
    const { container } = render(<ChatTip />);
    const glyph = container.querySelector("[aria-hidden]");

    // U+1F6C8 is absent from the font and would fall back to a system face.
    expect(glyph).toHaveTextContent("\u24D8");
    expect(container.textContent).not.toContain("\u{1F6C8}");
  });

  it("does not submit the form it sits inside", () => {
    const onSubmit = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <ChatTip />
      </form>,
    );

    expect(screen.getByRole("button", { name: "Dismiss tip" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("dismisses the tip when clicked", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());

    render(
      <form onSubmit={onSubmit}>
        <ChatTip />
      </form>,
    );

    await user.click(screen.getByRole("button", { name: "Dismiss tip" }));

    expect(dismissChatTip).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
