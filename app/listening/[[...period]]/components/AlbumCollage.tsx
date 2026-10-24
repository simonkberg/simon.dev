import Image from "next/image";
import type { CSSProperties } from "react";
import { use } from "react";

import type { TopAlbum } from "@/actions/lastfm";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { ExternalLink } from "@/components/ExternalLink";
import { Skeleton, SkeletonStatus } from "@/components/Skeleton";
import { coverWidth } from "@/lib/covers";
import { TOP_ALBUMS } from "@/lib/lastfm";

export interface AlbumCollageProps {
  // Undefined when the list failed to load.
  albums: Promise<readonly TopAlbum[] | undefined>;
}

const bayer = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// Half-strength levels: added to a cover at half brightness, they threshold to ordered dithering.
const bayerTile = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4">${bayer
    .flatMap((row, y) =>
      row.map((value, x) => {
        const level = Math.round(((value + 0.5) / 32) * 255);
        return `<rect x="${x}" y="${y}" width="1" height="1" fill="rgb(${level},${level},${level})"/>`;
      }),
    )
    .join("")}</svg>`,
)}`;

const collageStyle = {
  "--cover-dither": `url("${bayerTile}")`,
} as CSSProperties;

export const AlbumCollage = ({ albums }: AlbumCollageProps) => {
  const items = use(albums);

  if (items === undefined) {
    return <p>Top albums are temporarily unavailable :(</p>;
  }

  return (
    <div className="collage" style={collageStyle}>
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
