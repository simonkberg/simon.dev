import { use } from "react";

import { Subtitle } from "@/components/Subtitle";
import { fullDayLabel } from "@/lib/dates";
import type { DiaryEntry } from "@/lib/diary";

export interface DiaryListProps {
  // Undefined when the diary failed to load.
  entries: Promise<DiaryEntry[] | undefined>;
}

export const DiaryList = ({ entries }: DiaryListProps) => {
  const items = use(entries);

  if (items === undefined) {
    return <p>simon-bot&apos;s diary is temporarily unavailable :(</p>;
  }

  if (items.length === 0) {
    return <p>Nothing here yet.</p>;
  }

  return (
    <ul className="notes">
      {items.map(({ day, entry }) => (
        <li key={day}>
          {entry}{" "}
          <Subtitle>
            (<time dateTime={day}>{fullDayLabel(day)}</time>)
          </Subtitle>
        </li>
      ))}
    </ul>
  );
};
