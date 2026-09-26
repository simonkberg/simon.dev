import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import {
  preferenceCookie,
  themePreference,
  variantPreference,
} from "@/lib/preferences";
import { resetPreferences } from "@/mocks/preferences";

import { PreferenceSwitch } from "./PreferenceSwitch";

const root = document.documentElement;

afterEach(resetPreferences);

describe("PreferenceSwitch", () => {
  it("labels the group and presses the fallback without a choice", () => {
    render(<PreferenceSwitch preference={themePreference} />);

    const group = screen.getByRole("group", { name: "theme" });
    expect(
      within(group).getByRole("button", { name: "system" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "dark" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("applies and saves the chosen option", async () => {
    render(<PreferenceSwitch preference={variantPreference} />);

    await userEvent.click(screen.getByRole("button", { name: "manual" }));

    expect(root).toHaveAttribute("data-variant", "manual");
    expect(document.cookie).toContain("variant=manual");
    expect(screen.getByRole("button", { name: "manual" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("re-applies the saved option on mount", () => {
    document.cookie = preferenceCookie(themePreference, "light");

    render(<PreferenceSwitch preference={themePreference} />);

    expect(root).toHaveAttribute("data-theme", "light");
    expect(screen.getByRole("button", { name: "light" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("follows an option set elsewhere", async () => {
    render(<PreferenceSwitch preference={variantPreference} />);

    await act(async () => {
      root.setAttribute("data-variant", "ledger");
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "ledger" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
