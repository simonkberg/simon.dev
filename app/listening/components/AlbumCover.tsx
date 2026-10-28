"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

// The browser keeps a failed cover for 5s (its max-age), so each retry waits that out.
const RETRY_MS = [6_000, 15_000];

export interface AlbumCoverProps {
  // Undefined when Last.fm has no cover.
  src: string | undefined;
  width: number;
  name: string;
  artist: string;
}

/** The album's cover, retried when it fails to load, with a text sleeve until one does. */
export const AlbumCover = ({ src, width, name, artist }: AlbumCoverProps) => {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const retry = RETRY_MS[attempt];

  useEffect(() => {
    if (!failed || retry === undefined) return;
    const timer = setTimeout(() => setAttempt(attempt + 1), retry);
    return () => clearTimeout(timer);
  }, [failed, attempt, retry]);

  return (
    <>
      {src && (
        <span className="cover-art" data-failed={failed || undefined}>
          <Image
            key={attempt}
            src={src}
            width={width}
            height={width}
            alt=""
            onError={() => setFailed(true)}
            onLoad={() => setFailed(false)}
          />
        </span>
      )}
      {(!src || failed) && (
        <span className="cover-sleeve" aria-hidden="true">
          <span className="sleeve-name">{name}</span>
          <span className="sleeve-artist">{artist}</span>
        </span>
      )}
    </>
  );
};
