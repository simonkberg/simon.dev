import { Suspense } from "react";

import { getScrobbleMonths, getTopArtistByBucket } from "@/actions/listening";
import { ExternalLink } from "@/components/ExternalLink";
import { Heading } from "@/components/Heading";
import { Page } from "@/components/Page";
import { Subtitle } from "@/components/Subtitle";
import { config } from "@/config";
import { firstYear } from "@/lib/dates";
import { getToday } from "@/lib/today";
import { PeriodSelector } from "@/listening/components/PeriodSelector";

import { TimeTravel, TimeTravelSkeleton } from "./components/TimeTravel";
import { TravelProvider } from "./components/Travel";

// The tape lives here so moving between days keeps it, and its focus, in place.
export default function TimeTravelLayout({
  children,
  days,
}: LayoutProps<"/listening/on">) {
  const months = getScrobbleMonths().then((result) =>
    result.status === "ok" ? result.scrobbles : undefined,
  );
  const years = getTopArtistByBucket("overall").then((result) =>
    result.status === "ok" ? result.buckets : undefined,
  );

  return (
    <Page section="Listening">
      <section>
        <p>
          My listening on any day since {firstYear}, from{" "}
          <ExternalLink
            href={`https://www.last.fm/user/${config.lastfmUsername}`}
          >
            Last.fm
          </ExternalLink>
          .
        </p>
      </section>

      <PeriodSelector current="on" />

      <TravelProvider>
        <section>
          <Heading level={2}>
            Time Travel <Subtitle>(drag, or use the arrow keys)</Subtitle>
          </Heading>
          <Suspense fallback={<TimeTravelSkeleton />}>
            <TimeTravel today={getToday()} months={months} years={years}>
              {days}
            </TimeTravel>
          </Suspense>
        </section>

        {children}
      </TravelProvider>
    </Page>
  );
}
