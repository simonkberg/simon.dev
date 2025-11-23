import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GetTopArtistsResult } from "@/actions/lastfm";

import { TopArtistsTable } from "./TopArtistsTable";

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
