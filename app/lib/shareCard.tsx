// Satori calls these components as plain functions, outside React, so memoising them buys nothing.
"use no memo";

import "server-only";
import { readFile } from "node:fs/promises";

import { cacheLife } from "next/cache";
import { ImageResponse } from "next/og";
import { type CSSProperties, Fragment, type ReactNode } from "react";

import type { ScrobbleCount } from "@/actions/lastfm";
import { config } from "@/config";
import { formatNumber } from "@/lib/formatNumber";
import { labelTick, stemStats } from "@/lib/scrobbleChart";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Panes' dark palette from global.css, in hex since Satori reads no oklch();
// shareCard.test.tsx keeps them in step.
export const color = {
  ground: "#080a0e",
  wash: "#1a1d23",
  ink: "#e9ebef",
  muted: "#9399a1",
  rule: "#2b2e33",
  accent: "#ff87d0",
  onAccent: "#25151e",
};

// Satori reads no woff2 either, hence the release TTFs.
// An ArrayBuffer, since a cached Buffer comes back as one Satori can't read.
const read = async (url: URL) => new Uint8Array(await readFile(url)).buffer;

// Cached, since awaiting a read would make every card render per request.
// Literal URLs: Turbopack resolves a template's every expansion to one file.
async function loadFonts() {
  "use cache";
  cacheLife("max");
  const [regular, bold, italic] = await Promise.all([
    read(new URL("../assets/og/IosevkaSS08-Regular.ttf", import.meta.url)),
    read(new URL("../assets/og/IosevkaSS08-Bold.ttf", import.meta.url)),
    read(new URL("../assets/og/IosevkaSS08-Italic.ttf", import.meta.url)),
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
    <Segment>{config.location.toLowerCase()}</Segment>
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

export const Pane = ({
  number,
  title,
  subtitle,
  children,
}: {
  number: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      flex: 1,
      position: "relative",
      padding: "34px 28px 24px",
      border: `1px solid ${color.rule}`,
    }}
  >
    <div
      style={{
        position: "absolute",
        top: -12,
        left: 16,
        display: "flex",
        gap: 10,
        padding: "0 8px",
        background: color.ground,
        fontSize: 17,
      }}
    >
      <span style={{ color: color.accent }}>
        {String(number).padStart(2, "0")}
      </span>
      <span style={{ fontWeight: 700, letterSpacing: 1.4 }}>
        {title.toUpperCase()}
      </span>
      {subtitle && (
        <span style={{ color: color.muted }}>{`(${subtitle})`}</span>
      )}
    </div>
    {children}
  </div>
);

export interface StemsProps {
  counts: readonly ScrobbleCount[];
  width: number;
  height: number;
  // Labels the peak, the average and the buckets, as the listening page does.
  annotated?: boolean;
}

const dot = 7;
// Room above the peak for its label.
const peakRoom = 30;

// The scrobble chart's stems: a dot per bucket, hollow while it fills up.
export const Stems = ({
  counts,
  width,
  height,
  annotated = false,
}: StemsProps) => {
  const { max, peak, average } = stemStats(counts);
  const step = width / counts.length;
  const reach = height - dot - (annotated ? peakRoom : 0);
  const top = (count: number) => height - (count / max) * reach;
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width,
        height,
        borderBottom: `1px solid ${color.rule}`,
        fontSize: 16,
      }}
    >
      {annotated && average !== undefined && (
        <>
          <div
            style={{
              position: "absolute",
              left: 0,
              top: top(average),
              width,
              borderTop: `1px dashed ${color.muted}`,
            }}
          />
          <span
            style={{
              position: "absolute",
              left: width + 10,
              top: top(average) - 11,
              color: color.muted,
            }}
          >
            {`${formatNumber(average)} avg`}
          </span>
        </>
      )}
      {counts.map(({ label, count, current }, index) => {
        const x = step * index + step / 2;
        return (
          <Fragment key={label}>
            <div
              style={{
                position: "absolute",
                left: x - 0.75,
                top: top(count),
                height: height - top(count),
                width: 1.5,
                background: color.accent,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: x - dot / 2,
                top: top(count) - dot / 2,
                width: dot,
                height: dot,
                borderRadius: dot,
                border: `1.5px solid ${color.accent}`,
                background: current ? color.ground : color.accent,
              }}
            />
            {annotated && index === peak && (
              <span
                style={{
                  position: "absolute",
                  left: x - 60,
                  width: 120,
                  justifyContent: "center",
                  top: top(count) - peakRoom,
                  fontSize: 19,
                  color: color.accent,
                }}
              >
                {formatNumber(count)}
              </span>
            )}
            {annotated && labelTick(index, counts.length) && (
              <span
                style={{
                  position: "absolute",
                  left: x - 60,
                  width: 120,
                  justifyContent: "center",
                  top: height + 8,
                  color: color.muted,
                }}
              >
                {label}
              </span>
            )}
          </Fragment>
        );
      })}
    </div>
  );
};

export async function shareCard(
  { window }: { window: Window },
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
      <StatusLine title={window} />
    </div>,
    { ...size, fonts: await loadFonts() },
  );
}
