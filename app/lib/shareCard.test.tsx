// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { oklchToHex, palette, shareCard } from "./shareCard";

vi.mock(import("next/cache"), () => ({ cacheLife: vi.fn() }));

const css = readFileSync(join(import.meta.dirname, "../global.css"), "utf8");
const panes = /^:root\[data-variant="panes"\] \{([^}]*)\}/m.exec(css)?.[1];

describe("palette", () => {
  it.each(Object.entries(palette))("matches panes' dark %s", (name, value) => {
    const property = `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    const declared = new RegExp(
      `^\\s*${property}: light-dark\\(oklch\\([^)]+\\), (oklch\\([^)]+\\))\\);`,
      "m",
    ).exec(panes ?? "")?.[1];
    expect(declared).toBe(value);
  });
});

describe("oklchToHex", () => {
  // Chromium's own conversions, read back from a canvas.
  it.each([
    ["oklch(0.145 0.008 260)", "#080a0e"],
    ["oklch(0.94 0.006 260)", "#e9ebef"],
    ["oklch(0.78 0.17 345)", "#ff87d0"],
  ])("converts %s to %s", (color, hex) => {
    expect(oklchToHex(color)).toBe(hex);
  });
});

describe("shareCard", () => {
  it("renders a PNG", async () => {
    const response = await shareCard(
      { window: "home", title: "home" },
      <div>body</div>,
    );

    expect(response.headers.get("content-type")).toBe("image/png");
    const png = new Uint8Array(await response.arrayBuffer());
    expect([...png.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });
});
