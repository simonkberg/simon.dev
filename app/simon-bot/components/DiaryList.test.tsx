import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DiaryEntry } from "@/lib/diary";

import { DiaryList } from "./DiaryList";

const renderList = (entries: DiaryEntry[] | undefined) =>
  act(async () => render(<DiaryList entries={Promise.resolve(entries)} />));

describe("DiaryList", () => {
  it("dates each entry", async () => {
    await renderList([{ day: "2026-10-27", entry: "smog again" }]);

    expect(screen.getByRole("listitem")).toHaveTextContent(
      "smog again (Tue, Oct 27, 2026)",
    );
    expect(screen.getByText("Tue, Oct 27, 2026")).toHaveAttribute(
      "datetime",
      "2026-10-27",
    );
  });

  it.each([
    [[], "Nothing here yet."],
    [undefined, "simon-bot's diary is temporarily unavailable :("],
  ])("says so without entries", async (entries, text) => {
    await renderList(entries);

    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
