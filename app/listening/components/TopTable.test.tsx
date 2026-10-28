import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TopTrack } from "@/actions/listening";

import { TopTable, TopTableSkeleton } from "./TopTable";

vi.mock(import("@/components/AnimatedNumber"), () => ({
  AnimatedNumber: ({ value }: { value: number }) => <span>{value}</span>,
}));

const columns = [
  { label: "Track", key: "name" },
  { label: "Artist", key: "artist" },
] as const;

const renderTable = (rows: TopTrack[] | undefined) =>
  act(async () =>
    render(
      <TopTable rows={Promise.resolve(rows)} noun="tracks" columns={columns} />,
    ),
  );

describe("TopTable", () => {
  it("renders a ranked row per item under the given columns", async () => {
    const rows: TopTrack[] = [
      { name: "Track 1", artist: "Artist 1", playcount: 100, rank: 1 },
      { name: "Track 2", artist: "Artist 2", playcount: 50, rank: 2 },
    ];

    await renderTable(rows);

    expect(
      screen.getAllByRole("columnheader").map((th) => th.textContent),
    ).toEqual(["#", "Track", "Artist", "Plays"]);
    const [, first] = screen.getAllByRole("row");
    expect(
      within(first!)
        .getAllByRole("cell")
        .map((td) => td.textContent),
    ).toEqual(["1", "Track 1", "Artist 1", "100"]);
    expect(screen.getByText("Track 2")).toBeInTheDocument();
  });

  it("says the list is unavailable when it failed to load", async () => {
    await renderTable(undefined);

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.getByText("Top tracks are temporarily unavailable :("),
    ).toBeInTheDocument();
  });
});

describe("TopTableSkeleton", () => {
  it("announces loading without exposing the placeholder table", () => {
    render(<TopTableSkeleton columns={columns} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it.each([1, 2])(
    "renders ten ranked rows with %i text column(s) under the head",
    (count) => {
      const { container } = render(
        <TopTableSkeleton columns={columns.slice(0, count)} />,
      );

      expect(container.querySelectorAll("th")).toHaveLength(count + 2);
      const rows = container.querySelectorAll("tbody tr");
      expect(rows).toHaveLength(10);
      expect(rows[9]?.querySelector("td")).toHaveTextContent("10");
      expect(rows[0]?.querySelectorAll("td")).toHaveLength(count + 2);
    },
  );
});
