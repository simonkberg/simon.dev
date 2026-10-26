// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { color, shareCard, Stems } from "./shareCard";

vi.mock(import("next/cache"), () => ({ cacheLife: vi.fn() }));

const css = readFileSync(join(import.meta.dirname, "../global.css"), "utf8");
const panes = /^:root\[data-variant="panes"\] \{([^}]*)\}/m.exec(css)?.[1];

// OKLab to sRGB, as CSS Color 4 defines it.
function oklchToHex(oklch: string): string {
  const [l, c, h] = oklch.slice("oklch(".length, -1).split(" ").map(Number) as [
    number,
    number,
    number,
  ];
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lms = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ] as const;
  const linear = [
    4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
    -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
    -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
  ];
  return `#${linear
    .map((x) => {
      const srgb = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
      const byte = Math.round(Math.min(1, Math.max(0, srgb)) * 255);
      return byte.toString(16).padStart(2, "0");
    })
    .join("")}`;
}

describe("color", () => {
  // Chromium's own conversions, read back from a canvas.
  it.each([
    ["oklch(0.145 0.008 260)", "#080a0e"],
    ["oklch(0.68 0.014 260)", "#9399a1"],
    ["oklch(0.78 0.17 345)", "#ff87d0"],
  ])("is converted like a browser does: %s is %s", (oklch, hex) => {
    expect(oklchToHex(oklch)).toBe(hex);
  });

  it.each(Object.entries(color))("matches panes' dark %s", (name, hex) => {
    const property = `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    const dark = new RegExp(
      `^\\s*${property}: light-dark\\(oklch\\([^)]+\\), (oklch\\([^)]+\\))\\);`,
      "m",
    ).exec(panes ?? "")?.[1];
    expect(dark && oklchToHex(dark)).toBe(hex);
  });
});

describe("shareCard", () => {
  it("renders a PNG", async () => {
    const response = await shareCard({ window: "home" }, <div>body</div>);

    expect(response.headers.get("content-type")).toBe("image/png");
    const png = new Uint8Array(await response.arrayBuffer());
    expect([...png.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });
});

describe("Stems", () => {
  it("leaves out the average while the only bucket fills up", () => {
    const html = renderToStaticMarkup(
      <Stems
        counts={[{ label: "2026", count: 10, current: true }]}
        width={100}
        height={50}
        annotated
      />,
    );

    expect(html).toContain("2026");
    expect(html).not.toContain("avg");
  });
});
