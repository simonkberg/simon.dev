import "@/global.css";
import { GoogleTagManager } from "@next/third-parties/google";
import type { PropsWithChildren } from "react";

import { iosevka } from "@/assets/fonts";
import { config } from "@/config";
import { defaultVariant, variantScript } from "@/lib/variant";

export const Layout = ({ children }: PropsWithChildren) => {
  return (
    // The head script swaps data-variant before hydration.
    <html
      lang="en"
      className={iosevka.className}
      data-variant={defaultVariant}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: variantScript }} />
      </head>
      <GoogleTagManager gtmId={config.gtmId} />
      <body>{children}</body>
    </html>
  );
};
