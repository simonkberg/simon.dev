import { use } from "react";

import type { GetTopAlbumsResult } from "@/actions/lastfm";
import { AnimatedNumber } from "@/components/AnimatedNumber";

export interface TopAlbumsTableProps {
  topAlbums: Promise<GetTopAlbumsResult>;
}

export const TopAlbumsTable = ({ topAlbums }: TopAlbumsTableProps) => {
  const result = use(topAlbums);

  if (result.status === "error") {
    return <p>Top albums are temporarily unavailable :(</p>;
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
          <th>Album</th>
          <th>Artist</th>
          <th className="numeric">Plays</th>
        </tr>
      </thead>
      <tbody>
        {result.albums.map((album) => (
          <tr key={`${album.rank}-${album.name}`}>
            <td className="numeric">{album.rank}</td>
            <td>{album.name}</td>
            <td>{album.artist}</td>
            <td className="numeric">
              <AnimatedNumber value={album.playcount} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
