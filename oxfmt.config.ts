import { defineConfig } from "oxfmt";

export default defineConfig({
  objectWrap: "collapse",
  printWidth: 80,
  sortImports: true,
  sortPackageJson: false,
  ignorePatterns: ["iosevka-license.md", "pnpm-lock.yaml"],
  // Wraps the embedded Markdown in `app/lib/anthropic.ts`.
  overrides: [{ files: ["**/*.ts"], options: { proseWrap: "always" } }],
});
