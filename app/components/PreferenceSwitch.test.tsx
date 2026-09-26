import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { Preferences } from "@/components/Preferences";
import { themePreference, variantPreference } from "@/lib/preferences";
import { refresh } from "@/mocks/navigation";

import { PreferenceSwitch } from "./PreferenceSwitch";

const root = document.documentElement;

afterEach(() => {
  for (const { name } of [variantPreference, themePreference]) {
    root.removeAttribute(`data-${name}`);
    document.cookie = `${name}=; max-age=0; path=/`;
  }
});

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

  it("presses the option the server rendered", () => {
    render(
      <Preferences variant="ledger" theme="dark">
        <PreferenceSwitch preference={themePreference} />
      </Preferences>,
    );

    expect(screen.getByRole("button", { name: "dark" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("applies and saves the chosen option, then refreshes", async () => {
    render(<PreferenceSwitch preference={variantPreference} />);

    await userEvent.click(screen.getByRole("button", { name: "manual" }));

    expect(root).toHaveAttribute("data-variant", "manual");
    expect(document.cookie).toContain("variant=manual");
    expect(screen.getByRole("button", { name: "manual" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(refresh).toHaveBeenCalled();
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
