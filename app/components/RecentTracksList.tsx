"use client";

import { Suspense, use, useEffect } from "react";

import {
  type GetRecentTracksResult,
  refreshRecentTracks,
} from "@/actions/lastfm";
import { RelativeTime } from "@/components/RelativeTime";
import { Skeleton, SkeletonStatus } from "@/components/Skeleton";
import { Subtitle } from "@/components/Subtitle";

const minute = 60_000;

export interface RecentTracksListProps {
  recentTracks: Promise<GetRecentTracksResult>;
}

export const RecentTracksList = ({ recentTracks }: RecentTracksListProps) => {
  const result = use(recentTracks);

  useEffect(() => {
    const interval = setInterval(() => void refreshRecentTracks(), minute);
    return () => clearInterval(interval);
  }, []);

  if (result.status === "error") {
    return <p>Recently played tracks are temporarily unavailable :(</p>;
  }

  return (
    <ul className="recent-tracks">
      {result.tracks.map((track) => (
        <li key={`${track.name}-${track.playedAt?.getTime()}`}>
          <>{track.name}</> &ndash; <em>{track.artist}</em>{" "}
          {track.loved ? " ❤ " : ""}
          {track.nowPlaying ? (
            <Subtitle className="now-playing">(Now playing)</Subtitle>
          ) : track.playedAt ? (
            <Subtitle>
              (
              <Suspense fallback="Loading">
                {/* Suspends due to usage of Date */}
                <RelativeTime date={track.playedAt} />
              </Suspense>
              )
            </Subtitle>
          ) : null}
        </li>
      ))}
    </ul>
  );
};

const trackWidths = [
  [14, 9],
  [9, 12],
  [18, 7],
  [11, 10],
  [16, 8],
] as const;

export const RecentTracksListSkeleton = () => (
  <SkeletonStatus>
    <ul className="recent-tracks placeholder" aria-hidden="true">
      {trackWidths.map(([name, artist], index) => (
        <li key={index}>
          <Skeleton width={`${name}ch`} /> &ndash;{" "}
          <Skeleton width={`${artist}ch`} />{" "}
          <Subtitle>
            <Skeleton width="12ch" />
          </Subtitle>
        </li>
      ))}
    </ul>
  </SkeletonStatus>
);
