import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DayPlay } from "@/actions/listening";

import { DayPlays } from "./DayPlays";

const renderPlays = (plays: readonly DayPlay[] | undefined) =>
  act(async () => render(<DayPlays plays={Promise.resolve(plays)} />));

describe("DayPlays", () => {
  it("lists each play with its time, the same track twice included", async () => {
    const play = { name: "Old Fools", artist: "The Magnetic Fields" };
    await renderPlays([
      { ...play, time: "16:27" },
      { ...play, time: "16:27" },
    ]);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(
      "16:27 Old Fools The Magnetic Fields",
    );
  });

  it("says nothing played on a quiet day", async () => {
    await renderPlays([]);

    expect(screen.getByText("Nothing played this day.")).toBeInTheDocument();
  });

  it("says the plays are unavailable when they failed to load", async () => {
    await renderPlays(undefined);

    expect(
      screen.getByText("The day’s plays are temporarily unavailable :("),
    ).toBeInTheDocument();
  });
});
