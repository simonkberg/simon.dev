"use client";

import Image from "next/image";
import { useReducer } from "react";

import { useTimeout } from "@/components/useTimeout";

// The browser keeps a failed cover for 5s (its max-age), so each retry waits that out.
const RETRY_MS = [6_000, 15_000];

export interface AlbumCoverProps {
  // Undefined when Last.fm has no cover.
  src: string | undefined;
  width: number;
  name: string;
  artist: string;
}

// The sleeve shows from the first failure until a retry loads.
interface Cover {
  status: "shown" | "failed" | "retrying";
  attempt: number;
}

function cover(state: Cover, action: "load" | "error" | "retry"): Cover {
  const { status, attempt } = state;
  switch (action) {
    case "load":
      return status === "shown" ? state : { status: "shown", attempt };
    case "error":
      return { status: "failed", attempt };
    case "retry":
      return { status: "retrying", attempt: attempt + 1 };
  }
}

/** The album's cover, retried when it fails to load, with a text sleeve until one does. */
export const AlbumCover = ({ src, width, name, artist }: AlbumCoverProps) => {
  const [{ status, attempt }, dispatch] = useReducer(cover, {
    status: "shown",
    attempt: 0,
  });
  const failed = status === "failed" || status === "retrying";
  const retry = status === "failed" ? RETRY_MS[attempt] : undefined;

  useTimeout(() => dispatch("retry"), retry);

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
            onError={() => dispatch("error")}
            onLoad={() => dispatch("load")}
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
