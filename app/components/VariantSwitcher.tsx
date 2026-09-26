"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

import {
  defaultVariant,
  isVariant,
  readVariantCookie,
  type Variant,
  variantCookie,
  variants,
} from "@/lib/variant";

const root = () => document.documentElement;

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(root(), {
    attributes: true,
    attributeFilter: ["data-variant"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): Variant {
  const variant = root().getAttribute("data-variant");
  return isVariant(variant) ? variant : defaultVariant;
}

const getServerSnapshot = (): Variant => defaultVariant;

function selectVariant(variant: Variant) {
  root().setAttribute("data-variant", variant);
  document.cookie = variantCookie(variant);
}

export const VariantSwitcher = () => {
  const current = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  // The head script applies the cookie before paint; the dev-mode remount
  // resets <html> attributes, so apply it again. A no-op in production.
  useLayoutEffect(() => {
    const saved = readVariantCookie(document.cookie);
    if (saved) root().setAttribute("data-variant", saved);
  }, []);

  return (
    <div className="variants" role="group" aria-label="Style">
      {variants.map((variant) => (
        <button
          key={variant}
          type="button"
          aria-pressed={current === variant}
          onClick={() => selectVariant(variant)}
        >
          {variant}
        </button>
      ))}
    </div>
  );
};
