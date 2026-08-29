import { defineConfig } from "oxfmt";

export default defineConfig({
  objectWrap: "collapse",
  printWidth: 80,
  sortImports: {
    // Without an explicit `side_effect` group, a bare `import "server-only"`
    // loses the blank line after it.
    groups: [
      "side_effect",
      "builtin",
      "external",
      ["internal", "subpath"],
      ["parent", "sibling", "index"],
      "style",
      "unknown",
    ],
  },
  sortPackageJson: false,
  ignorePatterns: ["iosevka-license.md", "pnpm-lock.yaml"],
  // Wraps the embedded Markdown in `app/lib/anthropic.ts`. Scoped, so real
  // `.md` files keep the default `preserve`.
  overrides: [{ files: ["**/*.ts"], options: { proseWrap: "always" } }],
});
