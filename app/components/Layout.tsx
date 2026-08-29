import "@/global.css";
import { GoogleTagManager } from "@next/third-parties/google";
import type { PropsWithChildren } from "react";

import { iosevka } from "@/assets/fonts";
import { config } from "@/config";

export const Layout = ({ children }: PropsWithChildren) => {
  return (
    <html lang="en" className={iosevka.className}>
      <GoogleTagManager gtmId={config.gtmId} />
      <body>{children}</body>
    </html>
  );
};
