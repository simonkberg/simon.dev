import { describe, expect, it } from "vitest";

import {
  preferenceCookie,
  preferences,
  savedOption,
  themePreference,
  variantPreference,
} from "./preferences";

describe("savedOption", () => {
  it("accepts every option of each preference", () => {
    for (const preference of preferences) {
      for (const option of preference.options) {
        expect(savedOption(preference, option)).toBe(option);
      }
    }
  });

  it("falls back for missing or unknown values", () => {
    expect(savedOption(variantPreference, undefined)).toBe("panes");
    expect(savedOption(variantPreference, "neon")).toBe("panes");
    expect(savedOption(themePreference, "panes")).toBe("system");
  });
});

describe("preferenceCookie", () => {
  it("saves the option for a year across the site", () => {
    expect(preferenceCookie(themePreference, "dark")).toBe(
      "theme=dark; path=/; max-age=31536000; samesite=lax",
    );
  });
});
