import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PublicNote } from "@/lib/memory";

import { NoteList, NoteListSkeleton } from "./NoteList";

const note = (overrides: Partial<PublicNote> = {}): PublicNote => ({
  id: 1,
  content: "dry and unbothered",
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: undefined,
  ...overrides,
});

const renderNotes = (notes: PublicNote[] | undefined) =>
  act(async () => render(<NoteList notes={Promise.resolve(notes)} />));

describe("NoteList", () => {
  it("dates a note from when it was written", async () => {
    await renderNotes([note()]);

    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent(/^dry and unbothered \(noted .+\)$/);
    expect(item.querySelector("time")).toHaveAttribute(
      "dateTime",
      "2025-01-01T00:00:00.000Z",
    );
  });

  it("dates a rewritten note from its last rewrite", async () => {
    await renderNotes([
      note({ updatedAt: new Date("2025-02-01T00:00:00.000Z") }),
    ]);

    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent(/\(rewritten .+\)$/);
    expect(item.querySelector("time")).toHaveAttribute(
      "dateTime",
      "2025-02-01T00:00:00.000Z",
    );
  });

  it("says when there are no notes yet", async () => {
    await renderNotes([]);

    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("says when the notes failed to load", async () => {
    await renderNotes(undefined);

    expect(
      screen.getByText("simon-bot's notes are temporarily unavailable :("),
    ).toBeInTheDocument();
  });
});

describe("NoteListSkeleton", () => {
  it("announces loading and hides the placeholder list", () => {
    render(<NoteListSkeleton />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
