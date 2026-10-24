import { afterEach, describe, expect, it } from "vitest";

import { resetPreferences } from "@/mocks/preferences";

import { runCommand } from "./commands";

afterEach(resetPreferences);

describe("runCommand", () => {
  it("aligns the help after each usage", () => {
    expect(runCommand("/help")).toEqual({
      status: "ok",
      output: [
        "/help                       List the commands",
        "/style panes|ledger|manual  Switch the style",
        "/theme system|light|dark    Switch the theme",
      ],
    });
  });

  it("shows the usage for an option it doesn't take", () => {
    expect(runCommand("/theme blue")).toEqual({
      status: "error",
      error: "Usage: /theme system|light|dark",
    });
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });
});
