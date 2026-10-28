import Image from "next/image";
import { use } from "react";

import type { TopAlbum } from "@/actions/listening";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { ExternalLink } from "@/components/ExternalLink";
import { Skeleton, SkeletonStatus } from "@/components/Skeleton";
import { coverWidth, TOP_ALBUMS } from "@/lib/covers";

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
              {album.cover && (
                <span className="cover-art">
                  <Image
                    src={album.cover}
                    width={coverWidth(index)}
                    height={coverWidth(index)}
                    alt=""
                  />
                </span>
              )}
              <span className="cover-rank" aria-hidden="true">
                {album.rank}
              </span>
              <span className="visually-hidden">
                {album.name} by {album.artist} on Last.fm
              </span>
            </ExternalLink>
          </li>
        ))}
        {/* Short lists are padded so the #1 tile never sits beside gaps. */}
        {Array.from({ length: TOP_ALBUMS - items.length }, (_, index) => (
          <li key={`empty-${index}`} aria-hidden="true">
            <span className="cover" />
          </li>
        ))}
      </ol>
      <ol className="collage-legend">
        {items.map((album) => (
          <li key={album.rank}>
            <span className="legend-rank numeric">{album.rank}</span>
            <span className="legend-name">{album.name}</span>
            <span className="legend-artist">{album.artist}</span>
            <span className="legend-plays numeric">
              <AnimatedNumber value={album.playcount} />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};

const nameWidths = [
  [14, 6],
  [19, 11],
  [8, 7],
  [22, 7],
  [15, 8],
  [13, 18],
  [26, 11],
  [16, 9],
  [10, 12],
  [20, 10],
] as const;

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
      <ol className="collage-legend">
        {nameWidths.map(([name, artist], index) => (
          <li key={index}>
            <span className="legend-rank numeric">{index + 1}</span>
            <span className="legend-name">
              <Skeleton width={name} />
            </span>
            <span className="legend-artist">
              <Skeleton width={artist} />
            </span>
            <span className="legend-plays numeric">
              <Skeleton width={3} />
            </span>
          </li>
        ))}
      </ol>
    </div>
  </SkeletonStatus>
);
