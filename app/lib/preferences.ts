import { arrayIncludes } from "ts-extras";

/**
 * Visitor preferences: each is a `data-*` attribute on `<html>` and a cookie
 * of the same name. The proxy rewrites every page to `/{variant}/{theme}/…`
 * from the cookies, so each combination is its own prerendered page.
 */
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

export function preferenceCookie<T extends string>(
  preference: Preference<T>,
  value: T,
) {
  return `${preference.name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

/** The saved option, or the fallback for a missing or unknown value. */
export function savedOption<T extends string>(
  preference: Preference<T>,
  value: string | undefined,
): T {
  return arrayIncludes(preference.options, value) ? value : preference.fallback;
}

export type Variant = (typeof variantPreference.options)[number];
export type Theme = (typeof themePreference.options)[number];
