import "@/lib/env";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  logging: { fetches: { fullUrl: true } },
  reactCompiler: true,
  turbopack: { root: import.meta.dirname },
  typedRoutes: true,
  experimental: { turbopackRustReactCompiler: true },
  // Last.fm's CDN 404s some resized covers in some regions, so Next resizes the original.
  images: {
    remotePatterns: [new URL("https://lastfm-img.freetls.fastly.net/i/u/**")],
    // Covers are the only images: 10rem tiles and a #1 tile up to a phone's width, at 1–3x.
    imageSizes: [160, 320, 480],
    deviceSizes: [640, 960, 1280],
  },
};

export default nextConfig;
