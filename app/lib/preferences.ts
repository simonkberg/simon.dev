/**
 * Visitor preferences: each is a `data-*` attribute on `<html>` and a cookie
 * of the same name. The server renders the fallback; the head script swaps in
 * the saved value before first paint.
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

export function isOption<T extends string>(
  preference: Preference<T>,
  value: unknown,
): value is T {
  return preference.options.includes(value as T);
}

/** The value saved in a `document.cookie` string, if valid. */
export function readPreference<T extends string>(
  preference: Preference<T>,
  cookie: string,
): T | undefined {
  const value = new RegExp(`(?:^|; )${preference.name}=([^;]*)`).exec(
    cookie,
  )?.[1];

  return isOption(preference, value) ? value : undefined;
}

export function preferenceCookie<T extends string>(
  preference: Preference<T>,
  value: T,
) {
  return `${preference.name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

type SavedPreference = Pick<Preference, "name" | "options">;

/**
 * Applies the saved preferences to the root. Stringified into a `<head>`
 * script so it runs before first paint, which is why it references nothing
 * outside itself and takes the options as an argument. The layout never reads
 * the cookies: `cookies()` there would make every page render per request.
 */
export function applySavedPreferences(saved: readonly SavedPreference[]) {
  for (const { name, options } of saved) {
    const value = new RegExp(`(?:^|; )${name}=([^;]*)`).exec(
      document.cookie,
    )?.[1];
    if (value && options.includes(value)) {
      document.documentElement.setAttribute(`data-${name}`, value);
    }
  }
}

const savedPreferences = preferences.map(({ name, options }) => ({
  name,
  options,
}));

export const preferencesScript = `(${applySavedPreferences.toString()})(${JSON.stringify(savedPreferences)})`;
