import { arrayIncludes } from "ts-extras";

export interface Preference<T extends string = string> {
  name: "variant" | "theme";
  label: string;
  options: readonly T[];
  fallback: T;
}

export const variantPreference = {
  name: "variant",
  label: "style",
  options: ["panes", "ledger", "manual"],
  fallback: "panes",
} as const satisfies Preference;

// "system" matches no `[data-theme]` rule, so `color-scheme: light dark`
// follows the visitor's OS setting.
export const themePreference = {
  name: "theme",
  label: "theme",
  options: ["system", "light", "dark"],
  fallback: "system",
} as const satisfies Preference;

export const preferences = [variantPreference, themePreference] as const;

export const colorSchemes = ["light", "dark"] as const;

// Each variant's --ground; preferences.test.ts keeps them in step with global.css.
export const grounds = {
  panes: { light: "oklch(0.99 0.002 255)", dark: "oklch(0.145 0.008 260)" },
  ledger: { light: "oklch(0.975 0.004 265)", dark: "oklch(0.16 0.012 265)" },
  manual: { light: "oklch(0.985 0.002 100)", dark: "oklch(0.17 0.004 100)" },
} as const satisfies Record<
  (typeof variantPreference.options)[number],
  Record<(typeof colorSchemes)[number], string>
>;

export function preferenceCookie<T extends string>(
  preference: Preference<T>,
  value: T,
) {
  return `${preference.name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

export const preferenceAttribute = (preference: Preference) =>
  `data-${preference.name}`;

export function currentPreference<T extends string>(
  preference: Preference<T>,
): T {
  const value = document.documentElement.getAttribute(
    preferenceAttribute(preference),
  );
  return arrayIncludes(preference.options, value) ? value : preference.fallback;
}

export function setPreference<T extends string>(
  preference: Preference<T>,
  value: T,
) {
  document.documentElement.setAttribute(preferenceAttribute(preference), value);
  document.cookie = preferenceCookie(preference, value);
  syncThemeColor();
}

// Stringified into the <head> script, so it references nothing outside itself.
export function applySavedPreferences(saved: readonly Preference[]) {
  for (const { name, options } of saved) {
    const value = new RegExp(`(?:^|; )${name}=([^;]*)`).exec(
      document.cookie,
    )?.[1];
    if (value && options.includes(value)) {
      document.documentElement.setAttribute(`data-${name}`, value);
    }
  }
}

const themeColorTags = 'meta[name="theme-color"]';

// Every tag, as React may have added fresh ones beside those the head script set.
export function syncThemeColor() {
  const root = document.documentElement;
  const variant = root.getAttribute("data-variant");
  const theme = root.getAttribute("data-theme");
  const ground =
    grounds[
      arrayIncludes(variantPreference.options, variant)
        ? variant
        : variantPreference.fallback
    ];
  for (const meta of document.querySelectorAll(themeColorTags)) {
    const scheme = meta.matches('[media*="dark"]') ? "dark" : "light";
    meta.setAttribute(
      "content",
      ground[arrayIncludes(colorSchemes, theme) ? theme : scheme],
    );
  }
}

// Before paint. A tag it changes no longer matches React's, so React adds its own after it.
const themeColorScript = `{
  const root = document.documentElement;
  const variant = root.getAttribute("data-variant");
  const theme = root.getAttribute("data-theme");
  const ground = ${JSON.stringify(grounds)}[
    ${JSON.stringify(variantPreference.options)}.includes(variant)
      ? variant
      : ${JSON.stringify(variantPreference.fallback)}
  ];
  for (const meta of document.querySelectorAll(${JSON.stringify(themeColorTags)})) {
    const scheme = meta.matches('[media*="dark"]') ? "dark" : "light";
    meta.setAttribute(
      "content",
      ground[${JSON.stringify(colorSchemes)}.includes(theme) ? theme : scheme],
    );
  }
}`;

export const preferencesScript = `(${applySavedPreferences.toString()})(${JSON.stringify(preferences)});${themeColorScript}`;
