import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { config } from "@/config";

import GlobalError from "./global-error";

vi.mock(import("@/components/Layout"), () => ({
  Layout: ({ children }: PropsWithChildren) => (
    <div data-testid="layout">{children}</div>
  ),
}));

describe("GlobalError", () => {
  const error = new Error("Test error message");
  const retry = vi.fn();

  afterEach(() => {
    retry.mockClear();
  });

  it("should have correct title", () => {
    render(<GlobalError error={error} retry={retry} />);

    expect(document.title).toEqual(`Error - ${config.title}`);
  });

  it("should render within Layout component", () => {
    render(<GlobalError error={error} retry={retry} />);

    expect(screen.getByTestId("layout")).toBeInTheDocument();
  });

  it("should display error message", () => {
    render(<GlobalError error={error} retry={retry} />);

    expect(screen.getByText("Test error message")).toBeInTheDocument();
  });

  it("should display 'Something went wrong!' heading", () => {
    render(<GlobalError error={error} retry={retry} />);

    expect(
      screen.getByRole("heading", { name: "Something went wrong!", level: 2 }),
    ).toBeInTheDocument();
  });

  it("should call retry function when 'Try again' button is clicked", async () => {
    const user = userEvent.setup();
    render(<GlobalError error={error} retry={retry} />);

    const button = screen.getByRole("button", { name: "Try again" });
    await user.click(button);

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
