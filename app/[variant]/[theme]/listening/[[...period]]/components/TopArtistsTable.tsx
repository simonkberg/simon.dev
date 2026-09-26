import { use } from "react";

import type { GetTopArtistsResult } from "@/actions/lastfm";
import { AnimatedNumber } from "@/components/AnimatedNumber";

export interface TopArtistsTableProps {
  topArtists: Promise<GetTopArtistsResult>;
}

export const TopArtistsTable = ({ topArtists }: TopArtistsTableProps) => {
  const result = use(topArtists);

  if (result.status === "error") {
    return <p>Top artists are temporarily unavailable :(</p>;
  }

  return (
    <table>
      <colgroup>
        <col />
        <col style={{ width: "100%" }} />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th className="numeric">#</th>
          <th>Artist</th>
          <th className="numeric">Plays</th>
        </tr>
      </thead>
      <tbody>
        {result.artists.map((artist) => (
          <tr key={`${artist.rank}-${artist.name}`}>
            <td className="numeric">{artist.rank}</td>
            <td>{artist.name}</td>
            <td className="numeric">
              <AnimatedNumber value={artist.playcount} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
