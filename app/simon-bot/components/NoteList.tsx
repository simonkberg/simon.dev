import { Suspense, use } from "react";

import { RelativeTime } from "@/components/RelativeTime";
import { Skeleton, SkeletonStatus } from "@/components/Skeleton";
import { Subtitle } from "@/components/Subtitle";
import type { Memory } from "@/lib/memory";

export interface NoteListProps {
  // Undefined when the notes failed to load.
  notes: Promise<Memory[] | undefined>;
}

export const NoteList = ({ notes }: NoteListProps) => {
  const items = use(notes);

  if (items === undefined) {
    return <p>simon-bot&apos;s notes are temporarily unavailable :(</p>;
  }

  if (items.length === 0) {
    return <p>Nothing here yet.</p>;
  }

  return (
    <ul className="notes">
      {items.map((note) => (
        <li key={note.id}>
          {note.content}{" "}
          <Subtitle>
            ({note.updatedAt ? "rewritten" : "noted"}{" "}
            <Suspense fallback="Loading">
              <RelativeTime date={note.updatedAt ?? note.createdAt} />
            </Suspense>
            )
          </Subtitle>
        </li>
      ))}
    </ul>
  );
};

const noteWidths = [42, 28, 36] as const;

export const NoteListSkeleton = () => (
  <SkeletonStatus>
    <ul className="notes placeholder" aria-hidden="true">
      {noteWidths.map((width, index) => (
        <li key={index}>
          <Skeleton width={width} />{" "}
          <Subtitle>
            <Skeleton width={16} />
          </Subtitle>
        </li>
      ))}
    </ul>
  </SkeletonStatus>
);
