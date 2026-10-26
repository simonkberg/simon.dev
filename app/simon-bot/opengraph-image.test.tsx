import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getBotNotes } from "@/actions/simonBot";
import type { Memory, PublicCategory } from "@/lib/memory";
import { shareCard } from "@/lib/shareCard";

import openGraphImage from "./opengraph-image";

vi.mock(import("@/lib/shareCard"), async (importOriginal) => ({
  ...(await importOriginal()),
  shareCard: vi.fn(),
}));

vi.mock(import("@/actions/simonBot"), () => ({ getBotNotes: vi.fn() }));

const note = (
  category: PublicCategory,
  content: string,
  createdAt: string,
  updatedAt?: string,
): Memory => ({
  id: content.length,
  category,
  content,
  createdAt: new Date(createdAt),
  updatedAt: updatedAt ? new Date(updatedAt) : undefined,
});

const notes = (entries: Partial<Record<PublicCategory, Memory[]>>) =>
  vi
    .mocked(getBotNotes)
    .mockResolvedValue({
      status: "ok",
      data: { self: [], style: [], interests: [], ...entries },
    });

const renderCard = async () => {
  await openGraphImage();
  const [[, body] = []] = vi.mocked(shareCard).mock.calls;
  await act(async () => render(body));
};

describe("opengraph-image", () => {
  it("quotes the most recently written note under its heading", async () => {
    notes({
      self: [
        note("self", "dry", "2026-10-01T12:00:00Z", "2026-10-25T12:00:00Z"),
      ],
      style: [note("style", "lowercase", "2026-10-20T12:00:00Z")],
    });

    await renderCard();

    expect(shareCard).toHaveBeenCalledWith(
      { window: "simon-bot" },
      expect.anything(),
    );
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.getByText("SELF")).toBeInTheDocument();
    expect(screen.getByText("(who it is)")).toBeInTheDocument();
    expect(screen.getByText("dry")).toBeInTheDocument();
    expect(screen.queryByText("lowercase")).not.toBeInTheDocument();
    expect(document.body).toHaveTextContent("rewritten Oct 25 ·");
  });

  it.each([
    ["short", "word ".repeat(20), 44, "word"],
    ["medium", "word ".repeat(30), 38, "word"],
    ["long", "word ".repeat(80), 32, "word…"],
  ])(
    "sizes a %s note to fit and cuts what doesn't",
    async (_, content, size, last) => {
      notes({
        interests: [note("interests", content, "2026-10-24T12:00:00Z")],
      });

      await renderCard();

      const words = screen.getAllByText(/^wo/);
      expect(words.at(-1)).toHaveTextContent(new RegExp(`^${last}$`));
      expect(words[0]?.parentElement).toHaveStyle({ fontSize: `${size}px` });
      expect(document.body).toHaveTextContent("noted Oct 24 ·");
    },
  );

  it("says so when there are no notes yet", async () => {
    notes({});

    await renderCard();

    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
    expect(screen.getByText("NOTES")).toBeInTheDocument();
  });

  it("says the notes are unavailable when they fail to load", async () => {
    vi.mocked(getBotNotes).mockResolvedValue({
      status: "error",
      error: "Failed",
    });

    await renderCard();

    expect(
      screen.getByText("simon-bot's notes are temporarily unavailable :("),
    ).toBeInTheDocument();
  });
});
