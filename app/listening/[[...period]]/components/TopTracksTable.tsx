import { use } from "react";

import type { GetTopTracksResult } from "@/actions/lastfm";
import { AnimatedNumber } from "@/components/AnimatedNumber";

import { TableSkeleton } from "./TableSkeleton";

export interface TopTracksTableProps {
  topTracks: Promise<GetTopTracksResult>;
}

const head = (
  <>
    <colgroup>
      <col />
      <col style={{ width: "50%" }} />
      <col style={{ width: "50%" }} />
      <col />
    </colgroup>
    <thead>
      <tr>
        <th className="numeric">#</th>
        <th>Track</th>
        <th>Artist</th>
        <th className="numeric">Plays</th>
      </tr>
    </thead>
  </>
);

export const TopTracksTable = ({ topTracks }: TopTracksTableProps) => {
  const result = use(topTracks);

  if (result.status === "error") {
    return <p>Top tracks are temporarily unavailable :(</p>;
  }

  return (
    <table>
      {head}
      <tbody>
        {result.tracks.map((track) => (
          <tr key={`${track.rank}-${track.name}`}>
            <td className="numeric">{track.rank}</td>
            <td>{track.name}</td>
            <td>{track.artist}</td>
            <td className="numeric">
              <AnimatedNumber value={track.playcount} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export const TopTracksTableSkeleton = () => (
  <TableSkeleton head={head} textColumns={2} />
);
