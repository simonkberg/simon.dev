import { afterEach, describe, expect, it } from "vitest";

import { resetPreferences } from "@/mocks/preferences";

import {
  applySavedPreferences,
  preferenceCookie,
  preferences,
  preferencesScript,
} from "./preferences";

const root = document.documentElement;

afterEach(resetPreferences);

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
    document.cookie = "myvariant=; max-age=0; path=/";
  });

  it("is what the head script runs, with every option", () => {
    expect(preferencesScript).toContain(applySavedPreferences.toString());
    for (const preference of preferences) {
      expect(preferencesScript).toContain(JSON.stringify(preference.options));
    }
  });
});
