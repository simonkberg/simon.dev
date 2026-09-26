import type { Metadata } from "next";
import { type ReactNode } from "react";

import { Layout } from "@/components/Layout";
import { config } from "@/config";

export const metadata: Metadata = {
  title: { default: config.title, template: `%s - ${config.title}` },
  description: config.description,
  alternates: { canonical: new URL(config.url) },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <Layout>{children}</Layout>;
}
