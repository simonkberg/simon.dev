import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { mockEnv } from "./mocks/env";

const isCI = process.env["CI"] === "true";

const config = defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "happy-dom",
    environmentOptions: {
      happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: true } },
    },
    include: ["app/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      enabled: isCI,
      provider: "v8",
      reporter: ["text", "text-summary", "lcov"],
      include: ["app/**/*.{ts,tsx}"],
    },
    reporters: isCI
      ? ["default", ["junit", { outputFile: "junit.xml" }]]
      : ["default"],
    env: mockEnv,
  },
});

export default config;
