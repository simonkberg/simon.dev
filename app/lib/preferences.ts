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

export const preferencesScript = `(${applySavedPreferences.toString()})(${JSON.stringify(preferences)})`;
