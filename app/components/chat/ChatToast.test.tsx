import {
  render,
  screen,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatToast } from "./ChatToast";

describe("ChatToast", () => {
  it("renders nothing when message is undefined", () => {
    const { container } = render(<ChatToast message={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders message when provided", () => {
    render(<ChatToast message="Test message" />);
    expect(screen.getByText("Test message")).toBeInTheDocument();
  });

  it("has correct accessibility attributes for default variant", () => {
    render(<ChatToast message="Test message" variant="default" />);
    const toast = screen.getByRole("status");

    expect(toast).toHaveAttribute("aria-live", "polite");
    expect(toast).toHaveAttribute("aria-atomic", "true");
  });

  it("has correct accessibility attributes for error variant", () => {
    render(<ChatToast message="Error message" variant="error" />);
    const toast = screen.getByRole("status");

    expect(toast).toHaveAttribute("aria-live", "assertive");
    expect(toast).toHaveAttribute("aria-atomic", "true");
  });

  it("renders close button with accessible label", () => {
    render(<ChatToast message="Test message" />);
    const closeButton = screen.getByRole("button", {
      name: "Close notification",
    });

    expect(closeButton).toBeInTheDocument();
    expect(closeButton).toHaveAttribute("type", "button");
  });

  it("hides toast when close button is clicked", async () => {
    const user = userEvent.setup();
    render(<ChatToast message="Test message" />);

    const closeButton = screen.getByRole("button", {
      name: "Close notification",
    });

    await user.click(closeButton);

    expect(screen.queryByText("Test message")).not.toBeInTheDocument();
  });

  it("hides toast after duration expires", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    render(<ChatToast message="Test message" duration={3000} />);
    expect(screen.getByText("Test message")).toBeInTheDocument();

    vi.advanceTimersByTime(3000);

    await waitForElementToBeRemoved(() => screen.queryByText("Test message"));

    vi.useRealTimers();
  });

  it("shows toast for custom duration", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ChatToast message="Test message" duration={10000} />);
    expect(screen.getByText("Test message")).toBeInTheDocument();

    vi.advanceTimersByTime(5000);
    expect(screen.getByText("Test message")).toBeInTheDocument();

    vi.advanceTimersByTime(5000);

    await waitForElementToBeRemoved(() => screen.getByText("Test message"));

    vi.useRealTimers();
  });

  it("shows new message when message prop changes", async () => {
    const { rerender } = render(<ChatToast message="First message" />);
    expect(screen.getByText("First message")).toBeInTheDocument();

    rerender(<ChatToast message="Second message" />);

    expect(screen.getByText("Second message")).toBeInTheDocument();
  });

  it("hides toast when message becomes undefined", async () => {
    const { rerender } = render(<ChatToast message="Test message" />);
    expect(screen.getByText("Test message")).toBeInTheDocument();

    rerender(<ChatToast message={undefined} />);

    expect(screen.queryByText("Test message")).not.toBeInTheDocument();
  });

  it("resets timer when message changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const { rerender } = render(
      <ChatToast message="First message" duration={5000} />,
    );
    expect(screen.getByText("First message")).toBeInTheDocument();

    vi.advanceTimersByTime(3000);

    rerender(<ChatToast message="Second message" duration={5000} />);

    expect(screen.getByText("Second message")).toBeInTheDocument();

    vi.advanceTimersByTime(3000);
    expect(screen.getByText("Second message")).toBeInTheDocument();

    vi.advanceTimersByTime(2000);
    vi.runAllTimers();

    await waitForElementToBeRemoved(() => screen.queryByText("Second message"));

    vi.useRealTimers();
  });

  it("applies correct variant class", () => {
    const { rerender } = render(
      <ChatToast message="Test message" variant="default" />,
    );
    expect(screen.getByRole("status")).toHaveClass("chat-toast", "default");

    rerender(<ChatToast message="Test message" variant="error" />);
    expect(screen.getByRole("status")).toHaveClass("chat-toast", "error");
  });
});
