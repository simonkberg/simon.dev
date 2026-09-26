import { afterEach, describe, expect, it } from "vitest";

import {
  applySavedVariant,
  defaultVariant,
  isVariant,
  readVariantCookie,
  variantCookie,
  variants,
  variantScript,
} from "./variant";

const root = document.documentElement;

afterEach(() => {
  root.removeAttribute("data-variant");
  document.cookie = "variant=; max-age=0; path=/";
});

describe("isVariant", () => {
  it("accepts every variant", () => {
    for (const variant of variants) {
      expect(isVariant(variant)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(isVariant("neon")).toBe(false);
    expect(isVariant(undefined)).toBe(false);
  });
});

describe("readVariantCookie", () => {
  it("reads the variant among other cookies", () => {
    expect(readVariantCookie("a=1; variant=ledger; b=2")).toBe("ledger");
  });

  it("ignores unknown values and similar names", () => {
    expect(readVariantCookie("variant=neon")).toBeUndefined();
    expect(readVariantCookie("myvariant=manual")).toBeUndefined();
    expect(readVariantCookie("")).toBeUndefined();
  });

  it("round-trips the cookie it writes", () => {
    for (const variant of variants) {
      expect(readVariantCookie(variantCookie(variant))).toBe(variant);
    }
  });
});

describe("applySavedVariant", () => {
  it("applies every saved variant to the root", () => {
    for (const variant of variants) {
      root.setAttribute("data-variant", defaultVariant);
      document.cookie = variantCookie(variant);

      applySavedVariant();

      expect(root).toHaveAttribute("data-variant", variant);
    }
  });

  it("leaves the default without a valid cookie", () => {
    root.setAttribute("data-variant", defaultVariant);
    document.cookie = "variant=neon; path=/";

    applySavedVariant();

    expect(root).toHaveAttribute("data-variant", defaultVariant);
  });

  it("is what the head script runs", () => {
    expect(variantScript).toBe(`(${applySavedVariant.toString()})()`);
  });
});
