import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, use } from "react";

import {
  getOnThisDay,
  getScrobbles,
  getTopAlbums,
  getTopArtists,
  getTopTracks,
} from "@/actions/lastfm";
import { ExternalLink } from "@/components/ExternalLink";
import { Heading } from "@/components/Heading";
import { Page } from "@/components/Page";
import { Subtitle } from "@/components/Subtitle";
import {
  isValidPeriod,
  type Period,
  periodLabels,
  periods,
} from "@/lib/lastfm";
import { bucketUnits } from "@/lib/scrobbleBuckets";

import { OnThisDay, OnThisDaySkeleton } from "./components/OnThisDay";
import { PeriodSelector } from "./components/PeriodSelector";
import {
  ScrobbleChart,
  ScrobbleChartSkeleton,
} from "./components/ScrobbleChart";
import { TopTable, TopTableSkeleton } from "./components/TopTable";

export const prefetch = "partial";
export const unstable_paramMatching = { period: "not-found" };
// Every valid period is prerendered, so reading params up front never blocks.
export const instant = false;

const trackColumns = [
  { label: "Track", key: "name" },
  { label: "Artist", key: "artist" },
] as const;
const artistColumns = [{ label: "Artist", key: "name" }] as const;
const albumColumns = [
  { label: "Album", key: "name" },
  { label: "Artist", key: "artist" },
] as const;

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
    period: period === "overall" ? [] : [period],
  }));
}

export default function ListeningPage({ params }: ListeningPageProps) {
  const period = toPeriod(use(params).period);
  const scrobbles = getScrobbles(period).then((result) =>
    result.status === "ok" ? result.scrobbles : undefined,
  );
  const onThisDay = getOnThisDay().then((result) =>
    result.status === "ok" ? result.days : { date: result.error, years: [] },
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
          <ExternalLink href="https://www.last.fm/user/magijo">
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
          <ScrobbleChart key={period} scrobbles={scrobbles} />
        </Suspense>
      </section>

      <section>
        <Heading level={2}>On This Day</Heading>
        <Suspense fallback={<OnThisDaySkeleton />}>
          <OnThisDay days={onThisDay} />
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
        <Suspense fallback={<TopTableSkeleton columns={albumColumns} />}>
          <TopTable rows={topAlbums} noun="albums" columns={albumColumns} />
        </Suspense>
      </section>
    </Page>
  );
}
