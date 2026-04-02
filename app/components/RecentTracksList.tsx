"use client";

import { Suspense, use, useEffect } from "react";

import { getRecentTracks, type GetRecentTracksResult } from "@/actions/lastfm";
import { RelativeTime } from "@/components/RelativeTime";
import { Subtitle } from "@/components/Subtitle";

const minute = 60_000;

export interface RecentTracksListProps {
  recentTracks: Promise<GetRecentTracksResult>;
}

export const RecentTracksList = ({ recentTracks }: RecentTracksListProps) => {
  const result = use(recentTracks);

  useEffect(() => {
    const interval = setInterval(() => getRecentTracks(), minute);
    return () => clearInterval(interval);
  }, []);

  if (result.status === "error") {
    return <p>Recently played tracks are temporarily unavailable :(</p>;
  }

  return (
    <ul>
      {result.tracks.map((track) => (
        <li key={`${track.name}-${track.playedAt?.getTime()}`}>
          <>{track.name}</> &ndash; <em>{track.artist}</em>{" "}
          {track.loved ? " ❤ " : ""}
          {track.nowPlaying ? (
            <Subtitle>(Now playing)</Subtitle>
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
