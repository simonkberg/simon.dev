import type { Metadata, Viewport } from "next";
import { type ReactNode } from "react";

import { Layout } from "@/components/Layout";
import { config } from "@/config";

export const viewport: Viewport = { viewportFit: "cover" };

export const metadata: Metadata = {
  metadataBase: new URL(config.url),
  title: { default: config.title, template: `%s - ${config.title}` },
  description: config.description,
  alternates: { canonical: new URL(config.url) },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <Layout>{children}</Layout>;
}
