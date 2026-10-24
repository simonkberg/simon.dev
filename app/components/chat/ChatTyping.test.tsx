import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { ChatTyping } from "./ChatTyping";
import { setTyping } from "./typing";

describe("ChatTyping", () => {
  afterEach(() => {
    act(() => setTyping([]));
  });

  it("keeps its line, empty, while nobody is typing", () => {
    const { container } = render(<ChatTyping />);

    expect(container.querySelector(".chat-typing")).toBeEmptyDOMElement();
  });

  it("renders nobody typing on the server", () => {
    act(() => setTyping(["simon"]));

    expect(renderToString(<ChatTyping />)).toBe(
      '<div class="chat-typing" aria-live="polite"></div>',
    );
  });

  it("shows a typing buddy for each typist", () => {
    render(<ChatTyping />);

    act(() => setTyping(["simon", "simon-bot"]));

    expect(screen.getAllByText("(°▽°)")).toHaveLength(2);
    expect(
      screen.getByText("simon and simon-bot are typing…"),
    ).toBeInTheDocument();
  });

  it("says one typist is typing", () => {
    render(<ChatTyping />);

    act(() => setTyping(["simon"]));

    expect(screen.getByText("simon is typing…")).toBeInTheDocument();
  });
});
