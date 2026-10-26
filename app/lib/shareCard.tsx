import "server-only";
import { readFile } from "node:fs/promises";

import { cacheLife } from "next/cache";
import { ImageResponse } from "next/og";
import type { CSSProperties, ReactNode } from "react";

import { config } from "@/config";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Panes' dark palette, as in global.css; global.test.ts keeps them in step.
export const palette = {
  ground: "oklch(0.145 0.008 260)",
  wash: "oklch(0.23 0.012 260)",
  ink: "oklch(0.94 0.006 260)",
  muted: "oklch(0.68 0.014 260)",
  rule: "oklch(0.3 0.01 260)",
  accent: "oklch(0.78 0.17 345)",
  onAccent: "oklch(0.22 0.03 345)",
} as const;

// Satori reads neither oklch() nor woff2, hence the conversion and the woff subsets.
export function oklchToHex(color: string): string {
  const [l = 0, c = 0, h = 0] = (/oklch\(([^)]+)\)/.exec(color)?.[1] ?? "")
    .split(" ")
    .map(Number);
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

export const color = Object.fromEntries(
  Object.entries(palette).map(([name, value]) => [name, oklchToHex(value)]),
) as Record<keyof typeof palette, string>;

// An ArrayBuffer, since a cached Buffer comes back as one Satori can't read.
const read = async (url: URL) => new Uint8Array(await readFile(url)).buffer;

// Cached, since awaiting a read would make every card render per request.
// Literal URLs: Turbopack resolves a template's every expansion to one file.
async function loadFonts() {
  "use cache";
  cacheLife("max");
  const [regular, bold, italic] = await Promise.all([
    read(new URL("../assets/og/IosevkaSS08-Regular.woff", import.meta.url)),
    read(new URL("../assets/og/IosevkaSS08-Bold.woff", import.meta.url)),
    read(new URL("../assets/og/IosevkaSS08-Italic.woff", import.meta.url)),
  ]);
  return [
    { name: "Iosevka", data: regular, weight: 400, style: "normal" } as const,
    { name: "Iosevka", data: bold, weight: 700, style: "normal" } as const,
    { name: "Iosevka", data: italic, weight: 400, style: "italic" } as const,
  ];
}

const windows = ["home", "listening", "simon-bot"] as const;

export type Window = (typeof windows)[number];

const Header = ({ current }: { current: Window }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      height: 56,
      padding: "0 48px",
      borderBottom: `1px solid ${color.rule}`,
      fontSize: 20,
      gap: 18,
    }}
  >
    <span style={{ color: color.accent, marginRight: -6 }}>◆</span>
    <span style={{ fontWeight: 700, marginRight: 10 }}>
      {config.title.toLowerCase()}
    </span>
    {windows.map((name, index) => (
      <span
        key={name}
        style={{ color: name === current ? color.accent : color.muted }}
      >
        {`[${index}] ${name}${name === current ? "*" : ""}`}
      </span>
    ))}
    <span style={{ marginLeft: "auto", color: color.muted }}>simon.dev</span>
  </div>
);

const Segment = ({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) => (
  <span
    style={{
      display: "flex",
      alignItems: "center",
      height: 36,
      padding: "0 16px",
      background: color.wash,
      ...style,
    }}
  >
    {children}
  </span>
);

const StatusLine = ({ title }: { title: string }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      display: "flex",
      fontSize: 17,
      borderTop: `1px solid ${color.rule}`,
    }}
  >
    <Segment
      style={{
        background: color.accent,
        color: color.onAccent,
        fontWeight: 700,
      }}
    >
      {title.toUpperCase()}
    </Segment>
    <Segment>stockholm, sweden</Segment>
    <Segment style={{ marginLeft: "auto", background: "transparent" }}>
      <span style={{ color: color.muted }}>utf-8</span>
    </Segment>
    <Segment>simon.dev</Segment>
  </div>
);

export interface StemsProps {
  counts: readonly { count: number; current: boolean }[];
  width: number;
  height: number;
}

// The scrobble chart's stems: a dot per bucket, hollow while it fills up.
export const Stems = ({ counts, width, height }: StemsProps) => {
  const max = Math.max(1, ...counts.map(({ count }) => count));
  const step = width / counts.length;
  const dot = 7;
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width,
        height,
        borderBottom: `1px solid ${color.rule}`,
      }}
    >
      {counts.map(({ count, current }, index) => {
        const stem = (count / max) * (height - dot);
        const x = step * index + step / 2;
        return (
          <div key={index} style={{ display: "flex" }}>
            <div
              style={{
                position: "absolute",
                left: x - 0.75,
                top: height - stem,
                height: stem,
                width: 1.5,
                background: color.accent,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: x - dot / 2,
                top: height - stem - dot / 2,
                width: dot,
                height: dot,
                borderRadius: dot,
                border: `1.5px solid ${color.accent}`,
                background: current ? color.ground : color.accent,
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

export async function shareCard(
  { window, title }: { window: Window; title: string },
  body: ReactNode,
): Promise<ImageResponse> {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        position: "relative",
        width: "100%",
        height: "100%",
        background: color.ground,
        color: color.ink,
        fontFamily: "Iosevka",
      }}
    >
      <Header current={window} />
      {body}
      <StatusLine title={title} />
    </div>,
    { ...size, fonts: await loadFonts() },
  );
}
