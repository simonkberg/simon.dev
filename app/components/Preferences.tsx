"use client";

import { createContext, type PropsWithChildren, use } from "react";

import {
  type Preference,
  type Theme,
  themePreference,
  type Variant,
  variantPreference,
} from "@/lib/preferences";

export interface SavedPreferences {
  variant: Variant;
  theme: Theme;
}

const PreferencesContext = createContext<SavedPreferences>({
  variant: variantPreference.fallback,
  theme: themePreference.fallback,
});

export const Preferences = ({
  children,
  ...saved
}: PropsWithChildren<SavedPreferences>) => (
  <PreferencesContext value={saved}>{children}</PreferencesContext>
);

export const useSavedPreference = (preference: Preference) =>
  use(PreferencesContext)[preference.name];
