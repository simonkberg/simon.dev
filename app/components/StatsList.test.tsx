import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { WakaTimeStatsResult } from "@/actions/wakaTime";

import { StatsList } from "./StatsList";

describe("StatsList", () => {
  it("renders stats as list items", async () => {
    const successResult: WakaTimeStatsResult = {
      status: "ok",
      stats: [
        { name: "TypeScript", percent: 45.67 },
        { name: "JavaScript", percent: 30.12 },
      ],
    };

    await act(() =>
      render(<StatsList stats={Promise.resolve(successResult)} />),
    );

    const list = screen.getByRole("list");
    expect(list).toBeInTheDocument();

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);

    expect(items[0]).toHaveTextContent("TypeScript 45.67%");
    expect(items[1]).toHaveTextContent("JavaScript 30.12%");
  });

  it("displays error message when stats fetch fails", async () => {
    const errorResult: WakaTimeStatsResult = {
      status: "error",
      error: "Failed to fetch stats",
    };

    await act(() => render(<StatsList stats={Promise.resolve(errorResult)} />));

    expect(
      screen.getByText("Language statistics are temporarily unavailable :("),
    ).toBeInTheDocument();
  });

  it("displays empty state message when stats array is empty", async () => {
    const emptyResult: WakaTimeStatsResult = { status: "ok", stats: [] };

    await act(() => render(<StatsList stats={Promise.resolve(emptyResult)} />));

    expect(
      screen.getByText(/probably on vacation/, { exact: false }),
    ).toBeInTheDocument();
  });
});
