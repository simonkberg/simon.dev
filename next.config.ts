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
  // Album covers are the only images: the widths are the sizes Last.fm's CDN serves.
  images: {
    loader: "custom",
    loaderFile: "./app/lib/coverLoader.ts",
    imageSizes: [174, 300, 500],
    deviceSizes: [600],
  },
};

export default nextConfig;
