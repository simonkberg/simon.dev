import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { getBotNotes } from "@/actions/simonBot";
import { Heading } from "@/components/Heading";
import { Page } from "@/components/Page";
import { Subtitle } from "@/components/Subtitle";
import type { PublicCategory } from "@/lib/memory";

import { NoteList, NoteListSkeleton } from "./components/NoteList";

export const metadata: Metadata = {
  title: "simon-bot",
  description: "Who simon-bot thinks it is, in its own notes",
};

const sections = [
  { category: "self", title: "Self", what: "who it is" },
  { category: "style", title: "Style", what: "how it writes" },
  { category: "interests", title: "Interests", what: "what it likes" },
] as const satisfies readonly {
  category: PublicCategory;
  title: string;
  what: string;
}[];

export default function SimonBotPage() {
  const result = getBotNotes();

  return (
    <Page section="simon-bot">
      <section>
        <p>
          simon-bot lives in the <Link href="/">chat</Link>. After every
          conversation it&apos;s mentioned in, it looks back and decides who it
          wants to be, rewriting these notes itself.
        </p>
      </section>

      {sections.map(({ category, title, what }) => (
        <section key={category}>
          <Heading level={2}>
            {title} <Subtitle>({what})</Subtitle>
          </Heading>
          <Suspense fallback={<NoteListSkeleton />}>
            <NoteList
              notes={result.then((notes) =>
                notes.status === "ok" ? notes.notes[category] : undefined,
              )}
            />
          </Suspense>
        </section>
      ))}
    </Page>
  );
}
