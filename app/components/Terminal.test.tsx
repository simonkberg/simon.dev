import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Terminal } from "./Terminal";

describe("Terminal", () => {
  const mockRequestFullscreen = vi.fn();
  const mockExitFullscreen = vi.fn();

  beforeEach(() => {
    Object.defineProperty(document, "fullscreenElement", {
      writable: true,
      value: null,
    });
    document.exitFullscreen = mockExitFullscreen;
    HTMLElement.prototype.requestFullscreen = mockRequestFullscreen;
  });

  afterEach(() => {
    mockRequestFullscreen.mockClear();
    mockExitFullscreen.mockClear();
  });

  it("renders children content", () => {
    render(
      <Terminal>
        <div>Terminal content</div>
      </Terminal>,
    );

    expect(screen.getByText("Terminal content")).toBeInTheDocument();
  });

  it("calls requestFullscreen when maximize button is clicked and not in fullscreen", async () => {
    const user = userEvent.setup();
    render(<Terminal>Content</Terminal>);
    const maximizeButton = screen.getByRole("button", { name: "Maximize" });

    await user.click(maximizeButton);

    expect(mockRequestFullscreen).toHaveBeenCalledTimes(1);
    expect(mockExitFullscreen).not.toHaveBeenCalled();
  });

  it("calls exitFullscreen when maximize button is clicked and already in fullscreen", async () => {
    const user = userEvent.setup();
    Object.defineProperty(document, "fullscreenElement", {
      writable: true,
      value: document.createElement("div"),
    });

    render(<Terminal>Content</Terminal>);
    const maximizeButton = screen.getByRole("button", { name: "Maximize" });

    await user.click(maximizeButton);

    expect(mockExitFullscreen).toHaveBeenCalledTimes(1);
    expect(mockRequestFullscreen).not.toHaveBeenCalled();
  });

  it("renders terminal region with a maximize button only", () => {
    render(<Terminal>Example content</Terminal>);

    const terminal = screen.getByRole("region", { name: "Terminal" });
    expect(within(terminal).getAllByRole("button")).toEqual([
      screen.getByRole("button", { name: "Maximize" }),
    ]);
  });
});
