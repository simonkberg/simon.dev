// Async, which the React Compiler would turn into a component it can't call outside a render.
"use no memo";

import type { Metadata } from "next";
import { Suspense } from "react";

import {
  getDayPlays,
  getDailyScrobbles,
  getScrobbleMonths,
  getTopArtistByBucket,
} from "@/actions/listening";
import { ExternalLink } from "@/components/ExternalLink";
import { Heading } from "@/components/Heading";
import { Page } from "@/components/Page";
import { Subtitle } from "@/components/Subtitle";
import { config } from "@/config";
import { fullDayLabel, monthLabel, monthOf } from "@/lib/days";
import { getToday } from "@/lib/today";
import { PeriodSelector } from "@/listening/components/PeriodSelector";
import { TopLists } from "@/listening/components/TopLists";

import { DayPlays, DayPlaysSkeleton } from "./components/DayPlays";
import { TimeTravel, TimeTravelSkeleton } from "./components/TimeTravel";
import { toDay } from "./toDay";

export const prefetch = "partial";
// Each day renders on its first visit, so reading params up front makes it its own cached page.
export const instant = false;

type TimeTravelPageProps = PageProps<"/listening/on/[date]">;

// Cache Components needs one day to prerender: the first scrobbles.
export function generateStaticParams(): Awaited<
  TimeTravelPageProps["params"]
>[] {
  return [{ date: "2007-12-18" }];
}

export async function generateMetadata({
  params,
}: TimeTravelPageProps): Promise<Metadata> {
  const day = await toDay((await params).date);
  return {
    title: `Listening - ${fullDayLabel(day)}`,
    description: `What I played on ${fullDayLabel(day)}, from Last.fm`,
  };
}

export default async function TimeTravelPage({ params }: TimeTravelPageProps) {
  const [day, today] = await Promise.all([
    params.then(({ date }) => toDay(date)),
    getToday(),
  ]);
  const months = getScrobbleMonths().then((result) =>
    result.status === "ok" ? result.scrobbles : undefined,
  );
  const years = getTopArtistByBucket("overall").then((result) =>
    result.status === "ok" ? result.buckets : undefined,
  );
  const days = getDailyScrobbles(monthOf(day)).then((result) =>
    result.status === "ok" ? result.scrobbles : undefined,
  );
  const plays = getDayPlays(day).then((result) =>
    result.status === "ok" ? result.plays : undefined,
  );

  return (
    <Page section="Listening">
      <section>
        <p>
          My listening on any day since {config.lastfmSince}, from{" "}
          <ExternalLink
            href={`https://www.last.fm/user/${config.lastfmUsername}`}
          >
            Last.fm
          </ExternalLink>
          .
        </p>
      </section>

      <PeriodSelector current="on" />

      <section>
        <Heading level={2}>
          Time Travel <Subtitle>(drag, or use the arrow keys)</Subtitle>
        </Heading>
        <Suspense fallback={<TimeTravelSkeleton />}>
          <TimeTravel
            day={day}
            today={today}
            months={months}
            years={years}
            days={days}
          />
        </Suspense>
      </section>

      <section>
        <Heading level={2}>
          That Day <Subtitle>({fullDayLabel(day)})</Subtitle>
        </Heading>
        <Suspense fallback={<DayPlaysSkeleton />}>
          <DayPlays plays={plays} />
        </Suspense>
      </section>

      <TopLists span={monthOf(day)} subtitle={monthLabel(day)} />
    </Page>
  );
}
