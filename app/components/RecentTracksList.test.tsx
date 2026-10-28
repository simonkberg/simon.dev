import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GetRecentTracksResult } from "@/actions/listening";
import { refreshRecentTracks } from "@/actions/listening";
import type { RecentTrack } from "@/lib/scrobbles";

import { RecentTracksList } from "./RecentTracksList";
import { RelativeTime } from "./RelativeTime";

vi.mock(import("@/actions/listening"), () => ({
  refreshRecentTracks: vi.fn(),
}));

const createMockTrack = (
  overrides: Partial<RecentTrack> = {},
): RecentTrack => ({
  name: "Test Song",
  artist: "Test Artist",
  album: "Test Album",
  playedAt: undefined,
  nowPlaying: false,
  loved: false,
  ...overrides,
});

const ok = (...tracks: RecentTrack[]): GetRecentTracksResult => ({
  status: "ok",
  tracks,
});

const renderTracks = (result: GetRecentTracksResult) =>
  act(() =>
    render(<RecentTracksList recentTracks={Promise.resolve(result)} />),
  );

describe("RecentTracksList", () => {
  it("renders tracks as list items with name and artist", async () => {
    await renderTracks(
      ok(
        createMockTrack({ name: "Song 1", artist: "Artist 1" }),
        createMockTrack({ name: "Song 2", artist: "Artist 2" }),
      ),
    );

    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Song 1");
    expect(items[0]).toHaveTextContent("Artist 1");
    expect(items[1]).toHaveTextContent("Song 2");
    expect(items[1]).toHaveTextContent("Artist 2");
  });

  it("displays heart emoji for loved tracks", async () => {
    await renderTracks(
      ok(
        createMockTrack({ name: "Loved Song", loved: true }),
        createMockTrack({ name: "Regular Song", loved: false }),
      ),
    );

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("❤");
    expect(items[1]).not.toHaveTextContent("❤");
  });

  it("renders a relative time for past tracks", async () => {
    const playedAt = new Date(Date.now() - 5 * 60 * 1000);

    await renderTracks(ok(createMockTrack({ name: "Past Song", playedAt })));

    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("Past Song");
    const time = item.querySelector("time");
    expect(time).toHaveAttribute("dateTime", playedAt.toISOString());
    const { container } = render(<RelativeTime date={playedAt} />);
    expect(time?.textContent).toBe(container.textContent);
  });

  it("displays error message when tracks fetch fails", async () => {
    await renderTracks({
      status: "error",
      error: "Failed to fetch recent tracks",
    });

    expect(
      screen.getByText("Recently played tracks are temporarily unavailable :("),
    ).toBeInTheDocument();
  });

  it("shows now playing instead of a relative time, even if playedAt is set", async () => {
    await renderTracks(
      ok(
        createMockTrack({
          name: "Current Song",
          nowPlaying: true,
          playedAt: new Date(Date.now() - 5 * 60 * 1000),
        }),
      ),
    );

    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("Current Song");
    expect(screen.getByText("(Now playing)")).toBeInTheDocument();
    expect(item.querySelector("time")).not.toBeInTheDocument();
  });

  describe("polling for new tracks", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    it("refreshes recent tracks every minute", async () => {
      await renderTracks(ok(createMockTrack()));

      expect(refreshRecentTracks).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(60 * 1000);
      });

      expect(refreshRecentTracks).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(60 * 1000);
      });

      expect(refreshRecentTracks).toHaveBeenCalledTimes(2);
    });

    it("shows the tracks the refreshed page brings", async () => {
      const { rerender } = await renderTracks(
        ok(createMockTrack({ name: "Old Song" })),
      );

      await act(async () =>
        rerender(
          <RecentTracksList
            recentTracks={Promise.resolve(
              ok(createMockTrack({ name: "New Song" })),
            )}
          />,
        ),
      );

      expect(screen.getByRole("listitem")).toHaveTextContent("New Song");
    });

    it("cleans up interval on unmount", async () => {
      const { unmount } = await renderTracks(ok(createMockTrack()));

      await act(async () => {
        vi.advanceTimersByTime(60 * 1000);
      });

      expect(refreshRecentTracks).toHaveBeenCalledTimes(1);

      unmount();

      await act(async () => {
        vi.advanceTimersByTime(60 * 1000);
      });

      expect(refreshRecentTracks).toHaveBeenCalledTimes(1);
    });
  });
});
