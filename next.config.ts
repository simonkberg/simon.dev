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
  // Static routes only get s-maxage, so browsers refetch the emoji list on every visit.
  headers: async () => [
    {
      source: "/api/emoji",
      headers: [
        {
          key: "Cache-Control",
          value: "public, max-age=86400, stale-while-revalidate=604800",
        },
      ],
    },
  ],
};

export default nextConfig;
