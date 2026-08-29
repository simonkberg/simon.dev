"use client";

import { Heading } from "@/components/Heading";
import { Layout } from "@/components/Layout";
import { Page } from "@/components/Page";
import { config } from "@/config";

interface GlobalErrorProps {
  error: Error;
  retry: () => void;
}

export default function GlobalError({ error, retry }: GlobalErrorProps) {
  return (
    <Layout>
      <title>{`Error - ${config.title}`}</title>
      <Page section="Error">
        <section>
          <Heading level={2}>Something went wrong!</Heading>
          <p className="subtitle">{error.message}</p>
          <button className="link" onClick={() => retry()}>
            Try again
          </button>
        </section>
      </Page>
    </Layout>
  );
}
