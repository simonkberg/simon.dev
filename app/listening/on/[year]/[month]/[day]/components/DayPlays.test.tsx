import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DayPlay } from "@/actions/listening";

import { DayPlays } from "./DayPlays";

const renderPlays = (plays: readonly DayPlay[] | undefined) =>
  render(<DayPlays plays={plays} />);

describe("DayPlays", () => {
  it("lists each play with its time, the same track twice included", () => {
    const play = { name: "Old Fools", artist: "The Magnetic Fields" };
    renderPlays([
      { ...play, time: "16:27" },
      { ...play, time: "16:27" },
    ]);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(
      "16:27 Old Fools The Magnetic Fields",
    );
  });

  it("says nothing played on a quiet day", () => {
    renderPlays([]);

    expect(screen.getByText("Nothing played this day.")).toBeInTheDocument();
  });

  it("says the plays are unavailable when they failed to load", () => {
    renderPlays(undefined);

    expect(
      screen.getByText("The day’s plays are temporarily unavailable :("),
    ).toBeInTheDocument();
  });
});
