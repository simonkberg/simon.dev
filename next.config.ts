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
    // Covers are the only images: one width each for the tiles and the #1 tile (`coverWidth`).
    imageSizes: [320],
    deviceSizes: [960],
  },
};

export default nextConfig;
