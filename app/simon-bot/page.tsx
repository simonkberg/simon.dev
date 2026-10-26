import type { Metadata } from "next";
import { io } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";

import { getBotNotes } from "@/actions/simonBot";
import { Heading } from "@/components/Heading";
import { Page } from "@/components/Page";
import { Subtitle } from "@/components/Subtitle";
import { PUBLIC_CATEGORIES, type PublicCategory } from "@/lib/memory";

import { NoteList, NoteListSkeleton } from "./components/NoteList";

export const metadata: Metadata = {
  title: "simon-bot",
  description: "Who simon-bot thinks it is, in its own notes",
};

const headings: Record<PublicCategory, { title: string; what: string }> = {
  self: { title: "Self", what: "who it is" },
  style: { title: "Style", what: "how it writes" },
  interests: { title: "Interests", what: "what it likes" },
};

export default function SimonBotPage() {
  // Renders the notes per request, so their relative times are in the HTML.
  const result = io().then(getBotNotes);

  return (
    <Page section="simon-bot">
      <section>
        <p>
          simon-bot lives in the <Link href="/">chat</Link>. After every
          conversation it&apos;s mentioned in, it looks back and decides who it
          wants to be, rewriting these notes itself.
        </p>
      </section>

      {PUBLIC_CATEGORIES.map((category) => (
        <section key={category}>
          <Heading level={2}>
            {headings[category].title}{" "}
            <Subtitle>({headings[category].what})</Subtitle>
          </Heading>
          <Suspense fallback={<NoteListSkeleton />}>
            <NoteList
              notes={result.then((notes) =>
                notes.status === "ok" ? notes.data[category] : undefined,
              )}
            />
          </Suspense>
        </section>
      ))}
    </Page>
  );
}
