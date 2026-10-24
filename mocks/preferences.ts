import { runInNewContext } from "node:vm";

import {
  colorSchemes,
  grounds,
  preferenceAttribute,
  preferences,
  preferencesScript,
  variantPreference,
} from "@/lib/preferences";

export function resetPreferences() {
  for (const preference of preferences) {
    document.documentElement.removeAttribute(preferenceAttribute(preference));
    document.cookie = `${preference.name}=; max-age=0; path=/`;
  }
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.remove();
  }
}

// The fallback tags Layout renders, light then dark.
export function renderThemeColorTags() {
  for (const scheme of colorSchemes) {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("media", `(prefers-color-scheme: ${scheme})`);
    meta.setAttribute("content", grounds[variantPreference.fallback][scheme]);
    document.head.append(meta);
  }
}

// The head script with only the document in scope, so a reference to the bundle throws.
export function runPreferencesScript() {
  runInNewContext(preferencesScript, { document });
}

export function themeColors() {
  return [...document.querySelectorAll('meta[name="theme-color"]')].map(
    (meta) => meta.getAttribute("content"),
  );
}
