import { use } from "react";

import type { GetTopTracksResult } from "@/actions/lastfm";

export interface TopTracksTableProps {
  topTracks: Promise<GetTopTracksResult>;
}

export const TopTracksTable = ({ topTracks }: TopTracksTableProps) => {
  const result = use(topTracks);

  if (result.status === "error") {
    return <p>Top tracks are temporarily unavailable :(</p>;
  }

  return (
    <table>
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
      <tbody>
        {result.tracks.map((track) => (
          <tr key={`${track.rank}-${track.name}`}>
            <td className="numeric">{track.rank}</td>
            <td>{track.name}</td>
            <td>{track.artist}</td>
            <td className="numeric">{track.playcount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
