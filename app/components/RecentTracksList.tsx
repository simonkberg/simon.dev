"use client";

import { use, useEffect, useState } from "react";

import { getRecentTracks, type GetRecentTracksResult } from "@/actions/lastfm";
import { Subtitle } from "@/components/Subtitle";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;
const day = 24 * hour;
const month = 30 * day;
const year = 365 * day;

const RelativeTime = ({ timestamp }: { timestamp: number }) => {
  const [now, setNow] = useState(Date.now);
  const relativeTime = now - timestamp;
  const elapsed = Math.abs(relativeTime);
  const sign = Math.sign(-relativeTime);

  useEffect(() => {
    if (elapsed > day) return;

    const timer = setInterval(
      () => setNow(Date.now()),
      elapsed < 2 * minute ? second : elapsed < hour ? minute : 5 * minute,
    );
    return () => clearInterval(timer);
  }, [elapsed]);

  if (elapsed < minute) {
    return rtf.format(sign * Math.round(elapsed / second), "second");
  } else if (elapsed < hour) {
    return rtf.format(sign * Math.round(elapsed / minute), "minute");
  } else if (elapsed < day) {
    return rtf.format(sign * Math.round(elapsed / hour), "hour");
  } else if (elapsed < month) {
    return rtf.format(sign * Math.round(elapsed / day), "day");
  } else if (elapsed < year) {
    return rtf.format(sign * Math.round(elapsed / month), "month");
  }

  return rtf.format(sign * Math.round(elapsed / year), "year");
};

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
        <li key={`${track.name}-${track.playedAt}`}>
          <>{track.name}</> &ndash; <em>{track.artist}</em>{" "}
          {track.loved ? " ❤ " : ""}
          {track.nowPlaying ? (
            <Subtitle>(Now playing)</Subtitle>
          ) : track.playedAt ? (
            <Subtitle>({<RelativeTime timestamp={track.playedAt} />})</Subtitle>
          ) : null}
        </li>
      ))}
    </ul>
  );
};
