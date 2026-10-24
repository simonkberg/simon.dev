import { act, render, screen } from "@testing-library/react";
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

  it("shows a typing buddy for each typist", () => {
    render(<ChatTyping />);

    act(() => setTyping(["simon", "simon-bot"]));

    expect(screen.getAllByText("(°▽°)")).toHaveLength(2);
  });

  it("says one typist is typing", () => {
    render(<ChatTyping />);

    act(() => setTyping(["simon"]));

    expect(screen.getByText("simon is typing…")).toBeInTheDocument();
  });
});
