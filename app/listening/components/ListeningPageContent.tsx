import type { Metadata } from "next";
import { Suspense } from "react";

import { getTopAlbums, getTopArtists, getTopTracks } from "@/actions/lastfm";
import { ExternalLink } from "@/components/ExternalLink";
import { Heading } from "@/components/Heading";
import { Loader } from "@/components/Loader";
import { Page } from "@/components/Page";
import { Subtitle } from "@/components/Subtitle";
import { type Period, periodLabels } from "@/lib/lastfm";

import { PeriodSelector } from "./PeriodSelector";
import { TopAlbumsTable } from "./TopAlbumsTable";
import { TopArtistsTable } from "./TopArtistsTable";
import { TopTracksTable } from "./TopTracksTable";

export function generateListeningMetadata(period: Period): Metadata {
  const label = periodLabels[period];
  return {
    title: `Listening - ${label}`,
    description: `My ${label} listening statistics from Last.fm`,
  };
}

export interface ListeningPageContentProps {
  period: Period;
}

export function ListeningPageContent({ period }: ListeningPageContentProps) {
  const label = periodLabels[period];
  const topTracks = getTopTracks(period);
  const topArtists = getTopArtists(period);
  const topAlbums = getTopAlbums(period);

  return (
    <Page section="Listening">
      <section>
        <p>
          My {label} listening statistics from{" "}
          <ExternalLink href="https://www.last.fm/user/magijo">
            Last.fm
          </ExternalLink>
          .
        </p>
      </section>

      <PeriodSelector current={period} />

      <Suspense fallback={<Loader />}>
        <section>
          <Heading level={2}>
            Top Tracks <Subtitle>(Top 10)</Subtitle>
          </Heading>
          <TopTracksTable topTracks={topTracks} />
        </section>

        <section>
          <Heading level={2}>
            Top Artists <Subtitle>(Top 10)</Subtitle>
          </Heading>
          <TopArtistsTable topArtists={topArtists} />
        </section>

        <section>
          <Heading level={2}>
            Top Albums <Subtitle>(Top 10)</Subtitle>
          </Heading>
          <TopAlbumsTable topAlbums={topAlbums} />
        </section>
      </Suspense>
    </Page>
  );
}
