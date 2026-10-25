import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ThemeColorTags } from "@/components/ThemeColorTags";

import {
  applySavedPreferences,
  grounds,
  preferenceCookie,
  preferences,
  preferencesScript,
  syncThemeColor,
  themePreference,
  variantPreference,
} from "./preferences";

const root = document.documentElement;

// The head script with only the document in scope, so a reference to the bundle throws.
const runPreferencesScript = () =>
  runInNewContext(preferencesScript, { document });

const themeColors = () =>
  [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) =>
    meta.getAttribute("content"),
  );

describe("applySavedPreferences", () => {
  it("applies every saved option to the root", () => {
    for (const preference of preferences) {
      for (const option of preference.options) {
        root.setAttribute(`data-${preference.name}`, preference.fallback);
        document.cookie = preferenceCookie(preference, option);

        applySavedPreferences(preferences);

        expect(root).toHaveAttribute(`data-${preference.name}`, option);
      }
    }
  });

  it("leaves the fallbacks without valid cookies", () => {
    root.setAttribute("data-variant", "panes");
    root.setAttribute("data-theme", "system");
    document.cookie = "myvariant=manual; path=/";
    document.cookie = "variant=neon; path=/";
    document.cookie = "theme=sepia; path=/";

    applySavedPreferences(preferences);

    expect(root).toHaveAttribute("data-variant", "panes");
    expect(root).toHaveAttribute("data-theme", "system");
  });

  it("is what the head script runs, with every option", () => {
    expect(preferencesScript).toContain(applySavedPreferences.toString());
    for (const preference of preferences) {
      expect(preferencesScript).toContain(JSON.stringify(preference.options));
    }
  });
});

describe("preferencesScript", () => {
  function runWith(variant: string, theme: string) {
    root.setAttribute("data-variant", variantPreference.fallback);
    root.setAttribute("data-theme", themePreference.fallback);
    document.cookie = `variant=${variant}; path=/`;
    document.cookie = `theme=${theme}; path=/`;
    render(<ThemeColorTags />);
    runPreferencesScript();
  }

  it("colours the browser per scheme under the system theme", () => {
    runWith("ledger", "system");

    expect(root).toHaveAttribute("data-variant", "ledger");
    expect(themeColors()).toEqual([grounds.ledger.light, grounds.ledger.dark]);
  });

  it("colours the browser with the chosen theme for both schemes", () => {
    runWith("manual", "dark");

    expect(themeColors()).toEqual([grounds.manual.dark, grounds.manual.dark]);
  });

  it("falls back to the fallback variant per scheme on unknown values", () => {
    root.setAttribute("data-variant", "neon");
    root.setAttribute("data-theme", "sepia");
    render(<ThemeColorTags />);

    runPreferencesScript();

    expect(themeColors()).toEqual([grounds.panes.light, grounds.panes.dark]);
  });
});

describe("syncThemeColor", () => {
  it("retints the tags after a change", () => {
    render(<ThemeColorTags />);
    root.setAttribute("data-variant", "ledger");
    root.setAttribute("data-theme", "light");

    syncThemeColor();

    expect(themeColors()).toEqual([grounds.ledger.light, grounds.ledger.light]);

    root.setAttribute("data-theme", "system");
    syncThemeColor();

    expect(themeColors()).toEqual([grounds.ledger.light, grounds.ledger.dark]);
  });

  it("falls back to the fallback variant's ground", () => {
    render(<ThemeColorTags />);
    root.setAttribute("data-variant", "neon");
    root.setAttribute("data-theme", "dark");

    syncThemeColor();

    expect(themeColors()).toEqual([grounds.panes.dark, grounds.panes.dark]);
  });
});

describe("grounds", () => {
  const css = readFileSync(join(import.meta.dirname, "../global.css"), "utf8");

  it.each(variantPreference.options)("is %s's --ground", (variant) => {
    const start = css.indexOf(`:root[data-variant="${variant}"] {`);
    const block = css.slice(start, css.indexOf("\n}", start));
    const { light, dark } = grounds[variant];

    expect(block.match(/--ground:[^;]*;/g)).toEqual([
      `--ground: light-dark(${light}, ${dark});`,
    ]);
  });
});
