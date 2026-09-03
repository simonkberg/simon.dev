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
    render(<ChatTip name="simon-bot" />);

    expect(
      screen.getByText(/mention .simon-bot. to chat with a clanker/),
    ).toBeInTheDocument();
  });

  it("shows the name the bot picked", () => {
    render(<ChatTip name="Mabel" />);

    expect(screen.getByText(/mention .Mabel. to chat/)).toBeInTheDocument();
  });

  it("uses an info glyph the font actually covers", () => {
    const { container } = render(<ChatTip name="simon-bot" />);

    // U+1F6C8 is absent from Iosevka and would fall back to a system face.
    expect(container.querySelector("[aria-hidden]")).toHaveTextContent(
      "\u24D8",
    );
  });

  it("dismisses the tip without submitting the form it sits inside", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());

    render(
      <form onSubmit={onSubmit}>
        <ChatTip name="simon-bot" />
      </form>,
    );

    await user.click(screen.getByRole("button", { name: "Dismiss tip" }));

    expect(dismissChatTip).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
