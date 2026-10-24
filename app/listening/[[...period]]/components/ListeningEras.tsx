import { use } from "react";

import type { Era } from "@/actions/lastfm";
import { formatNumber } from "@/lib/formatNumber";

export interface ListeningErasProps {
  // Undefined when the eras failed to load.
  eras: Promise<readonly Era[] | undefined>;
}

export const ListeningEras = ({ eras }: ListeningErasProps) => {
  const items = use(eras);

  if (items === undefined) {
    return <p>Eras are temporarily unavailable :(</p>;
  }

  return (
    <ol className="eras">
      {items.map(({ label, artist, current }) => (
        <li key={label} data-current={current || undefined}>
          {label}:{" "}
          {artist ? `${artist.name} (${formatNumber(artist.playcount)})` : "–"}
        </li>
      ))}
    </ol>
  );
};
