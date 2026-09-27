import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RecentTracksListSkeleton } from "./RecentTracksListSkeleton";

describe("RecentTracksListSkeleton", () => {
  it("announces loading without exposing the placeholder list", () => {
    render(<RecentTracksListSkeleton />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
