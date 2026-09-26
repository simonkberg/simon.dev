import "@/global.css";
import { GoogleTagManager } from "@next/third-parties/google";
import type { PropsWithChildren } from "react";

import { iosevka } from "@/assets/fonts";
import { Preferences, type SavedPreferences } from "@/components/Preferences";
import { config } from "@/config";
import { themePreference, variantPreference } from "@/lib/preferences";

export const Layout = ({
  children,
  variant = variantPreference.fallback,
  theme = themePreference.fallback,
}: PropsWithChildren<Partial<SavedPreferences>>) => (
  <html
    lang="en"
    className={iosevka.className}
    data-variant={variant}
    data-theme={theme}
  >
    <GoogleTagManager gtmId={config.gtmId} />
    <body>
      <Preferences variant={variant} theme={theme}>
        {children}
      </Preferences>
    </body>
  </html>
);
