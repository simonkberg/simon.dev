import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { variantCookie } from "@/lib/variant";

import { VariantSwitcher } from "./VariantSwitcher";

afterEach(() => {
  document.documentElement.removeAttribute("data-variant");
  document.cookie = "variant=; max-age=0; path=/";
});

describe("VariantSwitcher", () => {
  it("presses the default variant without a choice", () => {
    render(<VariantSwitcher />);

    expect(screen.getByRole("button", { name: "panes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "ledger" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("applies and saves the chosen variant", async () => {
    render(<VariantSwitcher />);

    await userEvent.click(screen.getByRole("button", { name: "manual" }));

    expect(document.documentElement).toHaveAttribute("data-variant", "manual");
    expect(document.cookie).toContain("variant=manual");
    expect(screen.getByRole("button", { name: "manual" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("re-applies the saved variant on mount", () => {
    document.cookie = variantCookie("ledger");

    render(<VariantSwitcher />);

    expect(document.documentElement).toHaveAttribute("data-variant", "ledger");
    expect(screen.getByRole("button", { name: "ledger" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("follows a variant set elsewhere", async () => {
    render(<VariantSwitcher />);

    await act(async () => {
      document.documentElement.setAttribute("data-variant", "ledger");
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "ledger" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
