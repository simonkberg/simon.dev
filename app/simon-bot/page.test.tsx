import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  getBotNotes,
  type GetBotNotesResult,
  type GetDiaryResult,
} from "@/actions/simonBot";

import SimonBotPage from "./page";

const createdAt = new Date("2025-01-01T00:00:00.000Z");

vi.mock(import("@/actions/simonBot"), () => ({
  getDiary: vi.fn(() =>
    Promise.resolve<GetDiaryResult>({
      status: "ok",
      data: [{ day: "2026-10-27", entry: "smog again" }],
    }),
  ),
  getBotNotes: vi.fn(() =>
    Promise.resolve<GetBotNotesResult>({
      status: "ok",
      data: {
        self: [
          {
            id: 1,
            category: "self",
            content: "dry",
            createdAt,
            updatedAt: undefined,
          },
        ],
        style: [
          {
            id: 2,
            category: "style",
            content: "lowercase",
            createdAt,
            updatedAt: undefined,
          },
        ],
        interests: [],
      },
    }),
  ),
}));

const renderPage = () => act(async () => render(<SimonBotPage />));

const section = (name: RegExp) =>
  screen.getByRole("heading", { name }).closest("section") as HTMLElement;

describe("SimonBotPage", () => {
  it("shows each category's notes under its own heading", async () => {
    await renderPage();

    expect(getBotNotes).toHaveBeenCalledOnce();
    expect(within(section(/^Self/)).getByRole("listitem")).toHaveTextContent(
      /^dry/,
    );
    expect(within(section(/^Style/)).getByRole("listitem")).toHaveTextContent(
      /^lowercase/,
    );
    expect(
      within(section(/^Interests/)).getByText("Nothing here yet."),
    ).toBeInTheDocument();
  });

  it("shows the diary's entries", async () => {
    await renderPage();

    expect(within(section(/^Diary/)).getByRole("listitem")).toHaveTextContent(
      "smog again (Tue, Oct 27, 2026)",
    );
  });

  it("says every section is unavailable when the notes failed to load", async () => {
    vi.mocked(getBotNotes).mockResolvedValue({
      status: "error",
      error: "Failed",
    });

    await renderPage();

    expect(
      screen.getAllByText("simon-bot's notes are temporarily unavailable :("),
    ).toHaveLength(3);
  });
});
