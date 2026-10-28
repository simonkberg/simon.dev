import type { Metadata } from "next";
import { Suspense } from "react";

import { getScrobbles, getTopArtistByBucket } from "@/actions/listening";
import { ExternalLink } from "@/components/ExternalLink";
import { Heading } from "@/components/Heading";
import { Page } from "@/components/Page";
import { Subtitle } from "@/components/Subtitle";
import { config } from "@/config";
import { type Period, periodLabels } from "@/lib/periods";
import { bucketUnits } from "@/lib/scrobbleBuckets";
import { PeriodSelector } from "@/listening/components/PeriodSelector";

import { ScrobbleChart, ScrobbleChartSkeleton } from "./ScrobbleChart";
import { TopLists } from "./TopLists";

export const periodMetadata = (period: Period): Metadata => ({
  title: `Listening - ${periodLabels[period]}`,
  description: `My ${periodLabels[period]} listening statistics from Last.fm`,
});

export function ListeningPeriod({ period }: { period: Period }) {
  const scrobbles = getScrobbles(period).then((result) =>
    result.status === "ok" ? result.scrobbles : undefined,
  );
  const topArtistByBucket = getTopArtistByBucket(period).then((result) =>
    result.status === "ok" ? result.buckets : undefined,
  );

  return (
    <Page section="Listening">
      <section>
        <p>
          My {periodLabels[period]} listening statistics from{" "}
          <ExternalLink
            href={`https://www.last.fm/user/${config.lastfmUsername}`}
          >
            Last.fm
          </ExternalLink>
          .
        </p>
      </section>

      <PeriodSelector current={period} />

      <section>
        <Heading level={2}>
          Scrobbles <Subtitle>(per {bucketUnits[period]})</Subtitle>
        </Heading>
        <Suspense fallback={<ScrobbleChartSkeleton />}>
          {/* Keyed so a new period mounts fresh stems that grow in. */}
          <ScrobbleChart
            key={period}
            scrobbles={scrobbles}
            topArtistByBucket={topArtistByBucket}
          />
        </Suspense>
      </section>

      <TopLists span={period} subtitle="Top 10" />
    </Page>
  );
}
