"use client";

import type { ImageLoaderProps } from "next/image";

// Last.fm's CDN serves only these sizes; any other path returns the original upload.
// Not 770x0: the CDN 404s it in some regions.
const sizes = [
  [174, "174s"],
  [300, "300x300"],
  [500, "500x500"],
  [600, "600x600"],
] as const;

export default function coverLoader({ src, width }: ImageLoaderProps) {
  const [, path] = sizes.find(([size]) => size >= width) ?? sizes.at(-1)!;
  return src.replace(/\/i\/u\/[^/]+\//, `/i/u/${path}/`);
}
