export const variants = ["panes", "ledger", "manual"] as const;

export type Variant = (typeof variants)[number];

export const defaultVariant: Variant = "panes";

export function isVariant(value: unknown): value is Variant {
  return variants.includes(value as Variant);
}

/** The variant saved in a `document.cookie` string, if any. */
export function readVariantCookie(cookie: string): Variant | undefined {
  const value = /(?:^|; )variant=([^;]*)/.exec(cookie)?.[1];

  return isVariant(value) ? value : undefined;
}

export function variantCookie(variant: Variant) {
  return `variant=${variant}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Applies the saved variant to the root. Stringified into a `<head>` script
 * so it runs before first paint, which is why it references nothing outside
 * itself. The layout never reads the cookie: `cookies()` there would make
 * every page render per request.
 */
export function applySavedVariant() {
  const saved = /(?:^|; )variant=(panes|ledger|manual)(?:;|$)/.exec(
    document.cookie,
  )?.[1];
  if (saved) document.documentElement.setAttribute("data-variant", saved);
}

export const variantScript = `(${applySavedVariant.toString()})()`;
