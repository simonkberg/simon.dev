import type { Metadata } from "next";

import { Layout } from "@/components/Layout";
import { NotFoundPage, notFoundDescription } from "@/components/NotFoundPage";
import { config } from "@/config";

export const metadata: Metadata = {
  title: `Not Found - ${config.title}`,
  description: notFoundDescription,
};

export default function GlobalNotFound() {
  return (
    <Layout>
      <NotFoundPage />
    </Layout>
  );
}
