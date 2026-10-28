import type { Metadata } from "next";
import { Suspense } from "react";

import {
  getScrobbles,
  getTopArtistByBucket,
  getTopAlbums,
  getTopArtists,
  getTopTracks,
} from "@/actions/listening";
import { ExternalLink } from "@/components/ExternalLink";
import { Heading } from "@/components/Heading";
import { Page } from "@/components/Page";
import { Subtitle } from "@/components/Subtitle";
import { config } from "@/config";
import { type Period, periodLabels } from "@/lib/periods";
import { bucketUnits } from "@/lib/scrobbleBuckets";
import { PeriodSelector } from "@/listening/components/PeriodSelector";

import { AlbumCollage, AlbumCollageSkeleton } from "./AlbumCollage";
import { ScrobbleChart, ScrobbleChartSkeleton } from "./ScrobbleChart";
import { TopTable, TopTableSkeleton } from "./TopTable";

const trackColumns = [
  { label: "Track", key: "name" },
  { label: "Artist", key: "artist" },
] as const;
const artistColumns = [{ label: "Artist", key: "name" }] as const;

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
  const topTracks = getTopTracks(period).then((result) =>
    result.status === "ok" ? result.tracks : undefined,
  );
  const topArtists = getTopArtists(period).then((result) =>
    result.status === "ok" ? result.artists : undefined,
  );
  const topAlbums = getTopAlbums(period).then((result) =>
    result.status === "ok" ? result.albums : undefined,
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

      <section>
        <Heading level={2}>
          Top Tracks <Subtitle>(Top 10)</Subtitle>
        </Heading>
        <Suspense fallback={<TopTableSkeleton columns={trackColumns} />}>
          <TopTable rows={topTracks} noun="tracks" columns={trackColumns} />
        </Suspense>
      </section>

      <section>
        <Heading level={2}>
          Top Artists <Subtitle>(Top 10)</Subtitle>
        </Heading>
        <Suspense fallback={<TopTableSkeleton columns={artistColumns} />}>
          <TopTable rows={topArtists} noun="artists" columns={artistColumns} />
        </Suspense>
      </section>

      <section>
        <Heading level={2}>
          Top Albums <Subtitle>(Top 10)</Subtitle>
        </Heading>
        <Suspense fallback={<AlbumCollageSkeleton />}>
          <AlbumCollage albums={topAlbums} />
        </Suspense>
      </section>
    </Page>
  );
}
