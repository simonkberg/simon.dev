import { act, render, screen } from "@testing-library/react";
import { useParams } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getScrobbleMonths,
  type GetScrobblesResult,
  getTopArtistByBucket,
  type GetTopArtistByBucketResult,
} from "@/actions/listening";

import TimeTravelLayout from "./layout";

vi.mock(import("next/navigation"), () => ({
  useParams: vi.fn(),
  useRouter: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(useParams).mockReturnValue({ date: "2012-10-14" });
});

vi.mock(import("@/lib/today"), () => ({
  getToday: vi.fn(() => Promise.resolve("2026-10-28" as const)),
}));

vi.mock(import("@/actions/listening"), () => ({
  getScrobbleMonths: vi.fn(() =>
    Promise.resolve<GetScrobblesResult>({
      status: "ok",
      scrobbles: [{ label: "Jan 2007", count: 811, current: false }],
    }),
  ),
  getTopArtistByBucket: vi.fn(() =>
    Promise.resolve<GetTopArtistByBucketResult>({ status: "ok", buckets: [] }),
  ),
}));

const renderLayout = () =>
  act(async () =>
    render(
      <TimeTravelLayout
        days={<p>The month’s days</p>}
        params={Promise.resolve({})}
      >
        <p>The day’s page</p>
      </TimeTravelLayout>,
    ),
  );

describe("TimeTravelLayout", () => {
  it("keeps the tape around the month's days, above the day's page", async () => {
    await renderLayout();

    expect(screen.getByText("time travel")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(getScrobbleMonths).toHaveBeenCalled();
    expect(getTopArtistByBucket).toHaveBeenCalledWith("overall");
    expect(screen.getByRole("status")).toHaveTextContent("Sun, Oct 14, 2012");
    expect(screen.getByText("The month’s days")).toBeInTheDocument();
    expect(screen.getByText("The day’s page")).toBeInTheDocument();
  });

  it("says time travel is unavailable without the months", async () => {
    const error = { status: "error", error: "Failed" } as const;
    vi.mocked(getScrobbleMonths).mockResolvedValue(error);
    vi.mocked(getTopArtistByBucket).mockResolvedValue(error);

    await renderLayout();

    expect(
      screen.getByText("Time travel is temporarily unavailable :("),
    ).toBeInTheDocument();
    expect(screen.getByText("The day’s page")).toBeInTheDocument();
  });
});
