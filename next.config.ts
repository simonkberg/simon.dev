import type { NextConfig } from "next";

import "@/lib/env";
import { config } from "@/config";

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  logging: { fetches: { fullUrl: true } },
  reactCompiler: true,
  turbopack: { root: import.meta.dirname },
  typedRoutes: true,
  experimental: { turbopackRustReactCompiler: true },
  // Last.fm's CDN 404s some resized covers in some regions, so Next resizes the original.
  images: { remotePatterns: [new URL(`${config.lastfmCoverCdn}**`)] },
};

export default nextConfig;
