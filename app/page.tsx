import type { Viewport } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { getChatHistory } from "@/actions/chat";
import { getRecentTracks } from "@/actions/lastfm";
import { getWakaTimeStats } from "@/actions/wakaTime";
import { Chat } from "@/components/chat/Chat";
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

export default function RootPage() {
  const stats = getWakaTimeStats();
  const history = getChatHistory();
  const recentTracks = getRecentTracks();

  return (
    <Page>
      <section aria-labelledby="about-heading">
        <Heading level={2} id="about-heading">
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

      <section aria-labelledby="writing-heading">
        <Heading level={2} id="writing-heading">
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

      <section aria-labelledby="listening-heading">
        <Heading level={2} id="listening-heading">
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

      <section aria-labelledby="links-heading">
        <Heading level={2} id="links-heading">
          Links
        </Heading>
        <ul>
          {config.links.map((link) => (
            <li key={link.url}>
              <ExternalLink href={link.url}>{link.label}</ExternalLink>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="chat-heading">
        <Heading level={2} id="chat-heading">
          Chat
        </Heading>
        <Terminal>
          <Suspense fallback={<Loader />}>
            <Chat history={history} />
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
