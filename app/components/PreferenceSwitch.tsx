"use client";

import { useId, useLayoutEffect, useSyncExternalStore } from "react";

import {
  applySavedPreferences,
  currentPreference,
  type Preference,
  preferenceAttribute,
  setPreference,
  syncThemeColor,
} from "@/lib/preferences";

function subscribe(preference: Preference, onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [preferenceAttribute(preference)],
  });
  return () => observer.disconnect();
}

export interface PreferenceSwitchProps<T extends string> {
  preference: Preference<T>;
}

export const PreferenceSwitch = <T extends string>({
  preference,
}: PreferenceSwitchProps<T>) => {
  const labelId = useId();

  const current = useSyncExternalStore(
    (onChange) => subscribe(preference, onChange),
    () => currentPreference(preference),
    () => preference.fallback,
  );

  // The head script applies the cookie before paint, but the dev-mode
  // remount resets <html> attributes, so apply it again. Hydration can add
  // fallback theme-color tags after the script's, so tint those too.
  useLayoutEffect(() => {
    applySavedPreferences([preference]);
    syncThemeColor();
  }, [preference]);

  return (
    <div className="switch" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="label">
        {preference.label}
      </span>
      {preference.options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={current === option}
          onClick={() => setPreference(preference, option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
};
