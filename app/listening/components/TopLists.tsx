import { Suspense } from "react";

import {
  getTopAlbums,
  getTopArtists,
  getTopTracks,
  type Span,
} from "@/actions/listening";
import { Heading } from "@/components/Heading";
import { Subtitle } from "@/components/Subtitle";

import { AlbumCollage, AlbumCollageSkeleton } from "./AlbumCollage";
import { TopTable, TopTableSkeleton } from "./TopTable";

const trackColumns = [
  { label: "Track", key: "name" },
  { label: "Artist", key: "artist" },
] as const;
const artistColumns = [{ label: "Artist", key: "name" }] as const;

export interface TopListsProps {
  span: Span;
  subtitle: string;
}

export function TopLists({ span, subtitle }: TopListsProps) {
  const topTracks = getTopTracks(span).then((result) =>
    result.status === "ok" ? result.tracks : undefined,
  );
  const topArtists = getTopArtists(span).then((result) =>
    result.status === "ok" ? result.artists : undefined,
  );
  const topAlbums = getTopAlbums(span).then((result) =>
    result.status === "ok" ? result.albums : undefined,
  );

  return (
    <>
      <section>
        <Heading level={2}>
          Top Tracks <Subtitle>({subtitle})</Subtitle>
        </Heading>
        <Suspense fallback={<TopTableSkeleton columns={trackColumns} />}>
          <TopTable rows={topTracks} noun="tracks" columns={trackColumns} />
        </Suspense>
      </section>

      <section>
        <Heading level={2}>
          Top Artists <Subtitle>({subtitle})</Subtitle>
        </Heading>
        <Suspense fallback={<TopTableSkeleton columns={artistColumns} />}>
          <TopTable rows={topArtists} noun="artists" columns={artistColumns} />
        </Suspense>
      </section>

      <section>
        <Heading level={2}>
          Top Albums <Subtitle>({subtitle})</Subtitle>
        </Heading>
        <Suspense fallback={<AlbumCollageSkeleton />}>
          <AlbumCollage albums={topAlbums} />
        </Suspense>
      </section>
    </>
  );
}
