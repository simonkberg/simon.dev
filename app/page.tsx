import type { Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { getChatHistory } from "@/actions/chat";
import { getRecentTracks } from "@/actions/lastfm";
import { getWakaTimeStats } from "@/actions/wakaTime";
import { ChatHistory } from "@/components/ChatHistory";
import { ChatInput } from "@/components/ChatInput";
import { ExternalLink } from "@/components/ExternalLink";
import { Heading } from "@/components/Heading";
import { Loader } from "@/components/Loader";
import { Page } from "@/components/Page";
import { RecentTracksList } from "@/components/RecentTracksList";
import { StatsList } from "@/components/StatsList";
import { Subtitle } from "@/components/Subtitle";
import { Terminal } from "@/components/Terminal";
import { config } from "@/config";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "black",
};

export default async function RootPage() {
  const stats = getWakaTimeStats();
  const history = getChatHistory();
  const recentTracks = getRecentTracks();

  return (
    <Page>
      <section>
        <Heading level={2}>
          About <Subtitle>(Location: Stockholm, Sweden)</Subtitle>
        </Heading>
        <p>{config.description}</p>
        <p>
          Working as a senior engineer at{" "}
          <ExternalLink href="https://twitter.com/SpotifyEng">
            Spotify
          </ExternalLink>
          .
        </p>
      </section>

      <section>
        <Heading level={2}>
          Currently writing{" "}
          <Subtitle>
            (Via{" "}
            <ExternalLink href="https://wakatime.com/@simonkberg">
              WakaTime
            </ExternalLink>
            )
          </Subtitle>
        </Heading>
        <Suspense fallback={<Loader />}>
          <StatsList stats={stats} />
        </Suspense>
      </section>

      <section>
        <Heading level={2}>
          Currently listening to{" "}
          <Subtitle>
            (Via{" "}
            <ExternalLink href="https://www.last.fm/user/magijo">
              Last.fm
            </ExternalLink>
            )
          </Subtitle>
        </Heading>
        <Suspense fallback={<Loader />}>
          <RecentTracksList recentTracks={recentTracks} />
        </Suspense>
        <p>
          See <Link href="/listening/">listening statistics</Link>.
        </p>
      </section>

      <section>
        <Heading level={2}>Links</Heading>
        <ul>
          {config.links.map((link) => (
            <li key={link.url}>
              <ExternalLink href={link.url}>{link.label}</ExternalLink>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <Heading level={2}>Chat</Heading>
        <Terminal>
          <Suspense fallback={<Loader />}>
            <ChatHistory history={history} />
            <ChatInput />
          </Suspense>
        </Terminal>
      </section>

      <footer>
        <Subtitle>
          Hosted on{" "}
          <ExternalLink href="https://railway.com?referralCode=wzuAxn">
            Railway
          </ExternalLink>{" "}
          (affiliate link).
        </Subtitle>
      </footer>
    </Page>
  );
}
