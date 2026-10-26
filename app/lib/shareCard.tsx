// Satori calls these components as plain functions, outside React, so memoising them buys nothing.
"use no memo";

import "server-only";
import { readFile } from "node:fs/promises";

import { cacheLife } from "next/cache";
import { ImageResponse } from "next/og";
import { type CSSProperties, Fragment, type ReactNode } from "react";

import { config } from "@/config";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Panes' dark palette from global.css, in hex since Satori reads no oklch();
// shareCard.test.ts keeps them in step.
export const color = {
  ground: "#080a0e",
  wash: "#1a1d23",
  ink: "#e9ebef",
  muted: "#9399a1",
  rule: "#2b2e33",
  accent: "#ff87d0",
  onAccent: "#25151e",
};

// Satori reads no woff2 either, hence the woff subsets.
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

export type Window = (typeof config.pages)[number]["name"];

const host = new URL(config.url).host;

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
    {config.pages.map(({ name }, index) => (
      <span
        key={name}
        style={{ color: name === current ? color.accent : color.muted }}
      >
        {`[${index}] ${name}${name === current ? "*" : ""}`}
      </span>
    ))}
    <span style={{ marginLeft: "auto", color: color.muted }}>{host}</span>
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
    <Segment
      style={{
        marginLeft: "auto",
        background: "transparent",
        color: color.muted,
      }}
    >
      utf-8
    </Segment>
    <Segment>{host}</Segment>
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
          <Fragment key={index}>
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
          </Fragment>
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
