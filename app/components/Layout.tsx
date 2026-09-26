import "@/global.css";
import { GoogleTagManager } from "@next/third-parties/google";
import type { PropsWithChildren } from "react";

import { iosevka } from "@/assets/fonts";
import { config } from "@/config";
import {
  preferencesScript,
  themePreference,
  variantPreference,
} from "@/lib/preferences";

export const Layout = ({ children }: PropsWithChildren) => {
  return (
    // The head script swaps the data attributes before hydration.
    <html
      lang="en"
      className={iosevka.className}
      data-variant={variantPreference.fallback}
      data-theme={themePreference.fallback}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: preferencesScript }} />
      </head>
      <GoogleTagManager gtmId={config.gtmId} />
      <body>{children}</body>
    </html>
  );
};
