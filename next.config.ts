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
  // A day's month is its own segment, so moving between its days keeps the month's charts.
  rewrites: async () => [
    {
      source: "/listening/on/:month(\\d{4}-\\d{2})-:day(\\d{2})",
      destination: "/listening/on/:month/:day",
    },
  ],
};

export default nextConfig;
