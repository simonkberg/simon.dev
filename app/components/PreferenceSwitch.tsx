"use client";

import { useRouter } from "next/navigation";
import { useId, useSyncExternalStore } from "react";
import { arrayIncludes } from "ts-extras";

import { type Preference, preferenceCookie } from "@/lib/preferences";

import { useSavedPreference } from "./Preferences";

const attributeOf = (preference: Preference) => `data-${preference.name}`;

function subscribe(preference: Preference, onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [attributeOf(preference)],
  });
  return () => observer.disconnect();
}

function selectOption<T extends string>(preference: Preference<T>, value: T) {
  document.documentElement.setAttribute(attributeOf(preference), value);
  document.cookie = preferenceCookie(preference, value);
}

export interface PreferenceSwitchProps<T extends string> {
  preference: Preference<T>;
}

export const PreferenceSwitch = <T extends string>({
  preference,
}: PreferenceSwitchProps<T>) => {
  const labelId = useId();
  const router = useRouter();
  const saved = useSavedPreference(preference);

  const current = useSyncExternalStore(
    (onChange) => subscribe(preference, onChange),
    () => {
      const value = document.documentElement.getAttribute(
        attributeOf(preference),
      );
      return arrayIncludes(preference.options, value) ? value : saved;
    },
    () => saved,
  );

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
          onClick={() => {
            selectOption(preference, option);
            // Prefetched pages carry the old option in their <html>.
            router.refresh();
          }}
        >
          {option}
        </button>
      ))}
    </div>
  );
};
