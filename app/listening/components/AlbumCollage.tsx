import { use } from "react";

import type { TopAlbum } from "@/actions/listening";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { ExternalLink } from "@/components/ExternalLink";
import { SkeletonStatus } from "@/components/Skeleton";
import { coverWidth, TOP_ALBUMS } from "@/lib/covers";
import { formatPlays } from "@/lib/formatNumber";

import { AlbumCover } from "./AlbumCover";

export interface AlbumCollageProps {
  // Undefined when the list failed to load.
  albums: Promise<readonly TopAlbum[] | undefined>;
}

export const AlbumCollage = ({ albums }: AlbumCollageProps) => {
  const items = use(albums);

  if (items === undefined) {
    return <p>Top albums are temporarily unavailable :(</p>;
  }

  return (
    <div className="collage">
      <ol className="collage-covers">
        {items.map((album, index) => (
          <li key={album.rank}>
            <ExternalLink href={album.url} className="cover">
              <AlbumCover
                key={album.cover}
                src={album.cover}
                width={coverWidth(index)}
              />
              <span className="cover-rank" aria-hidden="true">
                {album.rank}
              </span>
              <span className="cover-plays numeric" aria-hidden="true">
                <AnimatedNumber value={album.playcount} />
              </span>
              <span className="cover-caption" aria-hidden="true">
                <span className="caption-name">{album.name}</span>
                <span className="caption-artist">{album.artist}</span>
              </span>
              <span className="visually-hidden">
                {`${album.name} by ${album.artist}, ${formatPlays(album.playcount)}, on Last.fm`}
              </span>
            </ExternalLink>
          </li>
        ))}
        {/* Short lists are padded so the large tiles never sit beside gaps. */}
        {Array.from({ length: TOP_ALBUMS - items.length }, (_, index) => (
          <li key={`empty-${index}`} aria-hidden="true">
            <span className="cover" />
          </li>
        ))}
      </ol>
    </div>
  );
};

export const AlbumCollageSkeleton = () => (
  <SkeletonStatus>
    <div className="collage placeholder" aria-hidden="true">
      <ol className="collage-covers">
        {Array.from({ length: TOP_ALBUMS }, (_, index) => (
          <li key={index}>
            <span className="cover" />
          </li>
        ))}
      </ol>
    </div>
  </SkeletonStatus>
);
