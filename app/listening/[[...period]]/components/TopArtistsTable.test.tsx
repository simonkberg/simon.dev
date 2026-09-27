import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GetTopArtistsResult } from "@/actions/lastfm";

import { TopArtistsTable, TopArtistsTableSkeleton } from "./TopArtistsTable";

vi.mock(import("@/components/AnimatedNumber"), () => ({
  AnimatedNumber: ({ value }: { value: number }) => <span>{value}</span>,
}));

describe("TopArtistsTable", () => {
  it("should render artists in a table", async () => {
    const result: GetTopArtistsResult = {
      status: "ok",
      artists: [
        { name: "Artist 1", playcount: 500, rank: 1 },
        { name: "Artist 2", playcount: 300, rank: 2 },
      ],
    };

    await act(async () =>
      render(<TopArtistsTable topArtists={Promise.resolve(result)} />),
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Artist 1")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("Artist 2")).toBeInTheDocument();
  });

  it("should render error message on failure", async () => {
    const result: GetTopArtistsResult = {
      status: "error",
      error: "Failed to fetch",
    };

    await act(async () =>
      render(<TopArtistsTable topArtists={Promise.resolve(result)} />),
    );

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });
});

describe("TopArtistsTableSkeleton", () => {
  it("renders ten placeholder rows under the real columns", () => {
    const { container } = render(<TopArtistsTableSkeleton />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      [...container.querySelectorAll("th")].map((th) => th.textContent),
    ).toEqual(["#", "Artist", "Plays"]);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(container.querySelectorAll("tbody tr:first-child td")).toHaveLength(
      3,
    );
  });
});
