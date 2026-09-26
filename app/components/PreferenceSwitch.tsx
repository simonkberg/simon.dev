"use client";

import { useId, useLayoutEffect, useSyncExternalStore } from "react";

import {
  isOption,
  type Preference,
  preferenceCookie,
  readPreference,
} from "@/lib/preferences";

const attributeOf = (preference: Preference) => `data-${preference.name}`;

function subscribe(preference: Preference, onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [attributeOf(preference)],
  });
  return () => observer.disconnect();
}

function applyOption<T extends string>(preference: Preference<T>, value: T) {
  document.documentElement.setAttribute(attributeOf(preference), value);
}

function selectOption<T extends string>(preference: Preference<T>, value: T) {
  applyOption(preference, value);
  document.cookie = preferenceCookie(preference, value);
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
    () => {
      const value = document.documentElement.getAttribute(
        attributeOf(preference),
      );
      return isOption(preference, value) ? value : preference.fallback;
    },
    () => preference.fallback,
  );

  // The head script applies the cookie before paint; the dev-mode remount
  // resets <html> attributes, so apply it again. A no-op in production.
  useLayoutEffect(() => {
    const saved = readPreference(preference, document.cookie);
    if (saved) applyOption(preference, saved);
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
          onClick={() => selectOption(preference, option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
};
