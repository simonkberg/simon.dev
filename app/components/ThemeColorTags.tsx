import { colorSchemes, grounds, variantPreference } from "@/lib/preferences";

export const ThemeColorTags = () =>
  colorSchemes.map((scheme) => (
    <meta
      key={scheme}
      name="theme-color"
      media={`(prefers-color-scheme: ${scheme})`}
      content={grounds[variantPreference.fallback][scheme]}
    />
  ));
