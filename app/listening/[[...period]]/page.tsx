import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, use } from "react";

import { getTopAlbums, getTopArtists, getTopTracks } from "@/actions/lastfm";
import { ExternalLink } from "@/components/ExternalLink";
import { Heading } from "@/components/Heading";
import { Loader } from "@/components/Loader";
import { Page } from "@/components/Page";
import { Subtitle } from "@/components/Subtitle";
import {
  isValidPeriod,
  type Period,
  periodLabels,
  periods,
} from "@/lib/lastfm";

import { PeriodSelector } from "./components/PeriodSelector";
import { TopAlbumsTable } from "./components/TopAlbumsTable";
import { TopArtistsTable } from "./components/TopArtistsTable";
import { TopTracksTable } from "./components/TopTracksTable";

type ListeningPageProps = PageProps<"/listening/[[...period]]">;

const toPeriod = (param?: string[]): Period => {
  if (param === undefined) return "overall";

  const [period, ...rest] = param;
  if (rest.length === 0 && isValidPeriod(period)) {
    return period;
  }

  notFound();
};

export async function generateMetadata({
  params,
}: ListeningPageProps): Promise<Metadata> {
  const period = toPeriod((await params).period);
  const periodLabel = periodLabels[period];

  return {
    title: `Listening - ${periodLabel}`,
    description: `My ${periodLabel} listening statistics from Last.fm`,
  };
}

export function generateStaticParams(): Awaited<
  ListeningPageProps["params"]
>[] {
  return periods.map((period) => ({
    period: period === "overall" ? undefined : [period],
  }));
}

export default function ListeningPage({ params }: ListeningPageProps) {
  const period = toPeriod(use(params).period);
  const topTracks = getTopTracks(period);
  const topArtists = getTopArtists(period);
  const topAlbums = getTopAlbums(period);

  return (
    <Page section="Listening">
      <section>
        <p>
          My {periodLabels[period]} listening statistics from{" "}
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
