import type { Metadata } from "next";
import { Suspense } from "react";

import { getOnThisDay } from "@/actions/listening";
import { ExternalLink } from "@/components/ExternalLink";
import { Heading } from "@/components/Heading";
import { Page } from "@/components/Page";
import { config } from "@/config";
import { getCommentary } from "@/lib/commentary";
import { Commentary } from "@/listening/components/Commentary";
import { PeriodSelector } from "@/listening/components/PeriodSelector";

import { OnThisDay, OnThisDaySkeleton } from "./components/OnThisDay";

export const metadata: Metadata = {
  title: "Listening - on this day",
  description: "What I played on this day in past years, from Last.fm",
};

export default function OnThisDayPage() {
  const days = getOnThisDay().then((result) =>
    result.status === "ok" ? result.days : undefined,
  );

  return (
    <Page section="Listening">
      <section>
        <p>
          What I played on this day in past years, from{" "}
          <ExternalLink
            href={`https://www.last.fm/user/${config.lastfmUsername}`}
          >
            Last.fm
          </ExternalLink>
          .
        </p>
      </section>

      <PeriodSelector current="on-this-day" />

      <section>
        <Heading level={2}>On This Day</Heading>
        <Suspense fallback={<OnThisDaySkeleton />}>
          <OnThisDay days={days} />
        </Suspense>
      </section>

      <Commentary page="on-this-day" stored={getCommentary("on-this-day")} />
    </Page>
  );
}
