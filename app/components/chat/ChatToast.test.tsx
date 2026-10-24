import {
  act,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatToast } from "./ChatToast";

describe("ChatToast", () => {
  it("renders nothing without a result", () => {
    const { container } = render(<ChatToast result={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("announces the error assertively", () => {
    render(<ChatToast result={{ error: "Test message" }} />);
    const toast = screen.getByRole("status");

    expect(toast).toHaveAttribute("aria-live", "assertive");
    expect(toast).toHaveAttribute("aria-atomic", "true");
    expect(toast).toHaveClass("chat-toast", "error");
  });

  it("hides toast when close button is clicked", async () => {
    const user = userEvent.setup();
    render(<ChatToast result={{ error: "Test message" }} />);

    const closeButton = screen.getByRole("button", {
      name: "Close notification",
    });
    expect(closeButton).toHaveAttribute("type", "button");

    await user.click(closeButton);

    expect(screen.queryByText("Test message")).not.toBeInTheDocument();
  });

  it("shows a new error when the result changes", async () => {
    const { rerender } = render(
      <ChatToast result={{ error: "First message" }} />,
    );
    expect(screen.getByText("First message")).toBeInTheDocument();

    rerender(<ChatToast result={{ error: "Second message" }} />);

    expect(screen.getByText("Second message")).toBeInTheDocument();
  });

  it("shows a repeated error again once dismissed", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ChatToast result={{ error: "Failed" }} />);
    await user.click(
      screen.getByRole("button", { name: "Close notification" }),
    );
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();

    rerender(<ChatToast result={{ error: "Failed" }} />);

    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("hides toast when the result becomes undefined", async () => {
    const { rerender } = render(
      <ChatToast result={{ error: "Test message" }} />,
    );
    expect(screen.getByText("Test message")).toBeInTheDocument();

    rerender(<ChatToast result={undefined} />);

    expect(screen.queryByText("Test message")).not.toBeInTheDocument();
  });

  describe("timer", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    it("hides the toast once its duration expires, not before", async () => {
      render(<ChatToast result={{ error: "Test message" }} duration={10000} />);
      expect(screen.getByText("Test message")).toBeInTheDocument();

      vi.advanceTimersByTime(5000);
      expect(screen.getByText("Test message")).toBeInTheDocument();

      vi.advanceTimersByTime(5000);

      await waitForElementToBeRemoved(() => screen.getByText("Test message"));
    });

    it("resets timer when the result changes", async () => {
      const { rerender } = render(
        <ChatToast result={{ error: "First message" }} duration={5000} />,
      );
      expect(screen.getByText("First message")).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(3000));

      rerender(
        <ChatToast result={{ error: "Second message" }} duration={5000} />,
      );
      await waitFor(() =>
        expect(screen.getByText("Second message")).toBeInTheDocument(),
      );
      await act(() => vi.advanceTimersByTimeAsync(3000));
      expect(screen.getByText("Second message")).toBeInTheDocument();

      vi.advanceTimersByTime(2000);

      await waitForElementToBeRemoved(() =>
        screen.queryByText("Second message"),
      );
    });
  });
});
