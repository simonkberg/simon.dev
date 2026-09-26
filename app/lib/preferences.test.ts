import { afterEach, describe, expect, it } from "vitest";

import {
  applySavedPreferences,
  isOption,
  preferenceCookie,
  preferences,
  preferencesScript,
  readPreference,
  themePreference,
  variantPreference,
} from "./preferences";

const root = document.documentElement;

afterEach(() => {
  for (const { name } of preferences) {
    root.removeAttribute(`data-${name}`);
    document.cookie = `${name}=; max-age=0; path=/`;
  }
});

describe("isOption", () => {
  it("accepts every option of each preference", () => {
    for (const preference of preferences) {
      for (const option of preference.options) {
        expect(isOption(preference, option)).toBe(true);
      }
    }
  });

  it("rejects anything else", () => {
    expect(isOption(variantPreference, "neon")).toBe(false);
    expect(isOption(themePreference, "panes")).toBe(false);
    expect(isOption(themePreference, undefined)).toBe(false);
  });
});

describe("readPreference", () => {
  it("reads each preference among other cookies", () => {
    const cookie = "a=1; variant=ledger; theme=dark; b=2";

    expect(readPreference(variantPreference, cookie)).toBe("ledger");
    expect(readPreference(themePreference, cookie)).toBe("dark");
  });

  it("ignores unknown values and similar names", () => {
    expect(readPreference(variantPreference, "variant=neon")).toBeUndefined();
    expect(
      readPreference(variantPreference, "myvariant=manual"),
    ).toBeUndefined();
    expect(readPreference(themePreference, "")).toBeUndefined();
  });

  it("round-trips the cookies it writes", () => {
    for (const preference of preferences) {
      for (const option of preference.options) {
        expect(
          readPreference(preference, preferenceCookie(preference, option)),
        ).toBe(option);
      }
    }
  });
});

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
