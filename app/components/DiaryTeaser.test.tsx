import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GetDiaryResult } from "@/actions/simonBot";

import { DiaryTeaser } from "./DiaryTeaser";

const renderTeaser = (result: GetDiaryResult) =>
  act(async () => render(<DiaryTeaser diary={Promise.resolve(result)} />));

describe("DiaryTeaser", () => {
  it("shows the latest entry with its day", async () => {
    await renderTeaser({
      status: "ok",
      data: [
        { day: "2026-10-27", entry: "smog again." },
        { day: "2026-10-26", entry: "older" },
      ],
    });

    expect(screen.getByText(/simon-bot's diary/)).toHaveTextContent(
      "simon-bot's diary, Tue, Oct 27, 2026",
    );
    expect(screen.getByRole("paragraph")).toHaveTextContent(
      "smog again. See every entry.",
    );
  });

  it.each<GetDiaryResult>([
    { status: "ok", data: [] },
    { status: "error", error: "Failed" },
  ])("shows nothing without an entry", async (result) => {
    const { container } = await renderTeaser(result);

    expect(container).toBeEmptyDOMElement();
  });
});
