import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatTyping } from "./ChatTyping";

describe("ChatTyping", () => {
  it("stays in the page, empty, while nobody is typing", () => {
    const { container } = render(<ChatTyping typing={[]} />);

    expect(container.querySelector(".typing")).toBeEmptyDOMElement();
  });

  it("shows a typing buddy for each typist", () => {
    render(<ChatTyping typing={["simon", "simon-bot"]} />);

    expect(screen.getAllByText("(°▽°)")).toHaveLength(2);
    expect(
      screen.getByText("simon and simon-bot are typing…"),
    ).toBeInTheDocument();
  });

  it("says one typist is typing", () => {
    render(<ChatTyping typing={["simon"]} />);

    expect(screen.getByText("simon is typing…")).toBeInTheDocument();
  });
});
