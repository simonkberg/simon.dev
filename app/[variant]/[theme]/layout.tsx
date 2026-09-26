import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { theme, variant } from "next/root-params";
import { type ReactNode, use } from "react";
import { arrayIncludes } from "ts-extras";

import { Layout } from "@/components/Layout";
import { config } from "@/config";
import {
  type Preference,
  themePreference,
  variantPreference,
} from "@/lib/preferences";

export const metadata: Metadata = {
  title: { default: config.title, template: `%s - ${config.title}` },
  description: config.description,
  alternates: { canonical: new URL(config.url) },
};

export function generateStaticParams() {
  return variantPreference.options.flatMap((variant) =>
    themePreference.options.map((theme) => ({ variant, theme })),
  );
}

// The proxy only rewrites to valid options; anything else is a request that
// skipped it, like `/api/nope`, matching these segments by accident.
function option<T extends string>(preference: Preference<T>, value: string): T {
  return arrayIncludes(preference.options, value) ? value : notFound();
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <Layout
      variant={option(variantPreference, use(variant()))}
      theme={option(themePreference, use(theme()))}
    >
      {children}
    </Layout>
  );
}
