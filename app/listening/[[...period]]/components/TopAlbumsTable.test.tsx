import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GetTopAlbumsResult } from "@/actions/lastfm";

import { TopAlbumsTable } from "./TopAlbumsTable";

vi.mock(import("@/components/AnimatedNumber"), () => ({
  AnimatedNumber: ({ value }: { value: number }) => <span>{value}</span>,
}));

describe("TopAlbumsTable", () => {
  it("should render albums in a table", async () => {
    const result: GetTopAlbumsResult = {
      status: "ok",
      albums: [
        { name: "Album 1", artist: "Artist 1", playcount: 200, rank: 1 },
        { name: "Album 2", artist: "Artist 2", playcount: 150, rank: 2 },
      ],
    };

    await act(async () =>
      render(<TopAlbumsTable topAlbums={Promise.resolve(result)} />),
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Album 1")).toBeInTheDocument();
    expect(screen.getByText("Artist 1")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("Album 2")).toBeInTheDocument();
  });

  it("should render error message on failure", async () => {
    const result: GetTopAlbumsResult = {
      status: "error",
      error: "Failed to fetch",
    };

    await act(async () =>
      render(<TopAlbumsTable topAlbums={Promise.resolve(result)} />),
    );

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });
});
