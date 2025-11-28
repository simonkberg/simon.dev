import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GetTopTracksResult } from "@/actions/lastfm";

import { TopTracksTable } from "./TopTracksTable";

vi.mock(import("@/components/AnimatedNumber"), () => ({
  AnimatedNumber: ({ value }: { value: number }) => <span>{value}</span>,
}));

describe("TopTracksTable", () => {
  it("should render tracks in a table", async () => {
    const result: GetTopTracksResult = {
      status: "ok",
      tracks: [
        { name: "Track 1", artist: "Artist 1", playcount: 100, rank: 1 },
        { name: "Track 2", artist: "Artist 2", playcount: 50, rank: 2 },
      ],
    };

    await act(async () =>
      render(<TopTracksTable topTracks={Promise.resolve(result)} />),
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Track 1")).toBeInTheDocument();
    expect(screen.getByText("Artist 1")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("Track 2")).toBeInTheDocument();
  });

  it("should render error message on failure", async () => {
    const result: GetTopTracksResult = {
      status: "error",
      error: "Failed to fetch",
    };

    await act(async () =>
      render(<TopTracksTable topTracks={Promise.resolve(result)} />),
    );

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });
});
