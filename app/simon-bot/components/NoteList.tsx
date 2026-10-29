import { type ReactNode, Suspense, use } from "react";

import { RelativeTime } from "@/components/RelativeTime";
import { Skeleton, SkeletonStatus } from "@/components/Skeleton";
import { Subtitle } from "@/components/Subtitle";
import { fullDayLabel } from "@/lib/dates";
import type { DiaryEntry } from "@/lib/diary";
import type { Memory } from "@/lib/memory";

export type Note = { key: string | number; content: string; when: ReactNode };

export const memoryNote = (memory: Memory): Note => ({
  key: memory.id,
  content: memory.content,
  when: (
    <>
      {memory.updatedAt ? "rewritten" : "noted"}{" "}
      <Suspense fallback="Loading">
        <RelativeTime date={memory.updatedAt ?? memory.createdAt} />
      </Suspense>
    </>
  ),
});

export const diaryNote = ({ day, entry }: DiaryEntry): Note => ({
  key: day,
  content: entry,
  when: <time dateTime={day}>{fullDayLabel(day)}</time>,
});

export interface NoteListProps {
  // Undefined when the notes failed to load.
  notes: Promise<Note[] | undefined>;
  /** What to say when they failed to load. */
  unavailable: string;
}

export const NoteList = ({ notes, unavailable }: NoteListProps) => {
  const items = use(notes);

  if (items === undefined) {
    return <p>{unavailable}</p>;
  }

  if (items.length === 0) {
    return <p>Nothing here yet.</p>;
  }

  return (
    <ul className="notes">
      {items.map(({ key, content, when }) => (
        <li key={key}>
          {content} <Subtitle>({when})</Subtitle>
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
