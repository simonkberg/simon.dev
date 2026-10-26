"use no memo";

import { getBotNotes } from "@/actions/simonBot";
import { dayLabel } from "@/lib/dates";
import {
  type Memory,
  PUBLIC_CATEGORIES,
  type PublicCategory,
} from "@/lib/memory";
import { color, Pane, shareCard } from "@/lib/shareCard";
import { stringToColor } from "@/lib/stringToColor";

import { headings } from "./components/headings";

export { contentType, size } from "@/lib/shareCard";

export const alt = "simon-bot's latest note on who it is, in its own words";

// The chat's colour for simon-bot's name.
const bot = stringToColor("simon-bot");

const touched = (note: Memory) => note.updatedAt ?? note.createdAt;

// What fits six lines at the smallest size.
const maxLength = 320;
const clip = (content: string) =>
  content.length > maxLength ? `${content.slice(0, maxLength - 1)}…` : content;

// Notes are one line of any length, so a long one gets a smaller size.
const fontSize = (content: string) =>
  content.length <= 110 ? 44 : content.length <= 180 ? 38 : 32;

const newest = (notes: Record<PublicCategory, Memory[]>) =>
  PUBLIC_CATEGORIES.flatMap((category) =>
    notes[category].map((note) => ({ category, note })),
  ).reduce<{ category: PublicCategory; note: Memory } | undefined>(
    (newest, entry) =>
      newest && touched(newest.note) >= touched(entry.note) ? newest : entry,
    undefined,
  );

const Note = ({ note }: { note: Memory }) => (
  <div style={{ display: "flex", flexDirection: "column" }}>
    {/* Satori lays out no inline text, so words wrap as flex items for the caret to follow. */}
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        marginTop: 14,
        fontSize: fontSize(note.content),
        lineHeight: 1.35,
        columnGap: "0.5em",
      }}
    >
      {clip(note.content)
        .split(" ")
        .map((word, index) => (
          <span key={index}>{word}</span>
        ))}
      <span style={{ color: bot }}>█</span>
    </div>
    <span style={{ marginTop: 24, fontSize: 19, color: color.muted }}>
      {`${note.updatedAt ? "rewritten" : "noted"} ${dayLabel.format(touched(note))} · simon-bot rewrites its notes after every conversation`}
    </span>
  </div>
);

const Missing = ({ children }: { children: string }) => (
  <span style={{ marginTop: 14, fontSize: 32, color: color.muted }}>
    {children}
  </span>
);

export default async function openGraphImage() {
  const result = await getBotNotes();
  const latest = result.status === "ok" ? newest(result.data) : undefined;
  const heading = latest && headings[latest.category];

  return shareCard(
    { window: "simon-bot" },
    <div style={{ display: "flex", flex: 1, padding: "40px 48px 36px" }}>
      <Pane
        number={latest ? PUBLIC_CATEGORIES.indexOf(latest.category) + 1 : 1}
        title={heading?.title ?? "Notes"}
        subtitle={heading?.what}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "4px 8px 0",
          }}
        >
          <span style={{ fontSize: 24, fontWeight: 700, color: bot }}>
            simon-bot:
          </span>
          {latest ? (
            <Note note={latest.note} />
          ) : result.status === "ok" ? (
            <Missing>Nothing here yet.</Missing>
          ) : (
            <Missing>
              simon-bot&apos;s notes are temporarily unavailable :(
            </Missing>
          )}
        </div>
      </Pane>
    </div>,
  );
}
