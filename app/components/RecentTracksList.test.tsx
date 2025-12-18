import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GetRecentTracksResult, RecentTrack } from "@/actions/lastfm";
import { getRecentTracks } from "@/actions/lastfm";

import { RecentTracksList } from "./RecentTracksList";

vi.mock(import("@/actions/lastfm"), () => ({ getRecentTracks: vi.fn() }));

describe("RecentTracksList", () => {
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

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders tracks as list items with name and artist", async () => {
    const successResult: GetRecentTracksResult = {
      status: "ok",
      tracks: [
        createMockTrack({ name: "Song 1", artist: "Artist 1" }),
        createMockTrack({ name: "Song 2", artist: "Artist 2" }),
      ],
    };

    await act(() =>
      render(
        <RecentTracksList recentTracks={Promise.resolve(successResult)} />,
      ),
    );

    const list = screen.getByRole("list");
    expect(list).toBeInTheDocument();

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);

    expect(items[0]).toHaveTextContent("Song 1");
    expect(items[0]).toHaveTextContent("Artist 1");
    expect(items[1]).toHaveTextContent("Song 2");
    expect(items[1]).toHaveTextContent("Artist 2");
  });

  it("displays heart emoji for loved tracks", async () => {
    const successResult: GetRecentTracksResult = {
      status: "ok",
      tracks: [
        createMockTrack({ name: "Loved Song", loved: true }),
        createMockTrack({ name: "Regular Song", loved: false }),
      ],
    };

    await act(() =>
      render(
        <RecentTracksList recentTracks={Promise.resolve(successResult)} />,
      ),
    );

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("❤");
    expect(items[1]).not.toHaveTextContent("❤");
  });

  it('displays "Now playing" for currently playing tracks', async () => {
    const successResult: GetRecentTracksResult = {
      status: "ok",
      tracks: [
        createMockTrack({
          name: "Current Song",
          nowPlaying: true,
          playedAt: undefined,
        }),
      ],
    };

    await act(() =>
      render(
        <RecentTracksList recentTracks={Promise.resolve(successResult)} />,
      ),
    );

    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("Current Song");
    expect(screen.getByText("(Now playing)")).toBeInTheDocument();
  });

  it("displays relative time for past tracks", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const now = Date.now();
    vi.setSystemTime(now);

    const fiveMinutesAgo = now - 5 * 60 * 1000;

    const successResult: GetRecentTracksResult = {
      status: "ok",
      tracks: [
        createMockTrack({
          name: "Past Song",
          nowPlaying: false,
          playedAt: fiveMinutesAgo,
        }),
      ],
    };

    await act(() =>
      render(
        <RecentTracksList recentTracks={Promise.resolve(successResult)} />,
      ),
    );

    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("Past Song");
    expect(screen.getByText(/5 minutes ago/)).toBeInTheDocument();

    vi.useRealTimers();
  });

  it("displays error message when tracks fetch fails", async () => {
    const errorResult: GetRecentTracksResult = {
      status: "error",
      error: "Failed to fetch recent tracks",
    };

    await act(() =>
      render(<RecentTracksList recentTracks={Promise.resolve(errorResult)} />),
    );

    expect(
      screen.getByText("Recently played tracks are temporarily unavailable :("),
    ).toBeInTheDocument();
  });

  it("does not display relative time for now playing tracks even if playedAt is set", async () => {
    const successResult: GetRecentTracksResult = {
      status: "ok",
      tracks: [
        createMockTrack({
          name: "Current Song",
          nowPlaying: true,
          playedAt: Date.now() - 5 * 60 * 1000,
        }),
      ],
    };

    await act(() =>
      render(
        <RecentTracksList recentTracks={Promise.resolve(successResult)} />,
      ),
    );

    expect(screen.getByText("(Now playing)")).toBeInTheDocument();
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument();
  });

  describe("RelativeTime component", () => {
    it.each([
      { offset: 30 * 1000, expected: /30 seconds ago/, description: "seconds" },
      {
        offset: 30 * 60 * 1000,
        expected: /30 minutes ago/,
        description: "minutes",
      },
      {
        offset: 5 * 60 * 60 * 1000,
        expected: /5 hours ago/,
        description: "hours",
      },
      {
        offset: 5 * 24 * 60 * 60 * 1000,
        expected: /5 days ago/,
        description: "days",
      },
      {
        offset: 60 * 24 * 60 * 60 * 1000,
        expected: /2 months ago/,
        description: "months",
      },
      {
        offset: 2 * 365 * 24 * 60 * 60 * 1000,
        expected: /2 years ago/,
        description: "years",
      },
    ])('displays "$description ago" format', async ({ offset, expected }) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const now = Date.now();
      vi.setSystemTime(now);
      const timestamp = now - offset;

      const successResult: GetRecentTracksResult = {
        status: "ok",
        tracks: [createMockTrack({ playedAt: timestamp })],
      };

      await act(() =>
        render(
          <RecentTracksList recentTracks={Promise.resolve(successResult)} />,
        ),
      );

      expect(screen.getByText(expected)).toBeInTheDocument();

      vi.useRealTimers();
    });

    it.each([
      {
        initialOffset: 30 * 1000,
        advanceBy: 1000,
        initialText: /30 seconds ago/,
        updatedText: /31 seconds ago/,
        description: "1 second for recent tracks",
      },
      {
        initialOffset: 5 * 60 * 1000,
        advanceBy: 60 * 1000,
        initialText: /5 minutes ago/,
        updatedText: /6 minutes ago/,
        description: "1 minute for tracks under an hour",
      },
      {
        initialOffset: 2 * 60 * 60 * 1000,
        advanceBy: 5 * 60 * 1000,
        initialText: /2 hours ago/,
        updatedText: /2 hours ago/,
        description: "5 minutes for tracks under a day (no visible change)",
      },
    ])(
      "updates relative time display after $description",
      async ({ initialOffset, advanceBy, initialText, updatedText }) => {
        vi.useFakeTimers({ shouldAdvanceTime: true });

        const now = Date.now();
        vi.setSystemTime(now);
        const timestamp = now - initialOffset;

        const successResult: GetRecentTracksResult = {
          status: "ok",
          tracks: [createMockTrack({ playedAt: timestamp })],
        };

        await act(() =>
          render(
            <RecentTracksList recentTracks={Promise.resolve(successResult)} />,
          ),
        );

        expect(screen.getByText(initialText)).toBeInTheDocument();

        await act(async () => {
          vi.advanceTimersByTime(advanceBy);
        });

        expect(screen.getByText(updatedText)).toBeInTheDocument();

        vi.useRealTimers();
      },
    );

    it("does not update relative time display for tracks older than a day", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const now = Date.now();
      vi.setSystemTime(now);

      const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;

      const successResult: GetRecentTracksResult = {
        status: "ok",
        tracks: [createMockTrack({ name: "Old Track", playedAt: twoDaysAgo })],
      };

      await act(() =>
        render(
          <RecentTracksList recentTracks={Promise.resolve(successResult)} />,
        ),
      );

      expect(screen.getByText(/2 days ago/)).toBeInTheDocument();

      // Advance time by a large amount
      await act(async () => {
        vi.advanceTimersByTime(60 * 60 * 1000);
      });

      // Should still show the same relative time (no timer running)
      expect(screen.getByText(/2 days ago/)).toBeInTheDocument();

      vi.useRealTimers();
    });
  });

  describe("polling for new tracks", () => {
    it("sets up interval to call getRecentTracks every minute", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const successResult: GetRecentTracksResult = {
        status: "ok",
        tracks: [createMockTrack()],
      };

      await act(() =>
        render(
          <RecentTracksList recentTracks={Promise.resolve(successResult)} />,
        ),
      );

      expect(getRecentTracks).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(60 * 1000);
      });

      expect(getRecentTracks).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(60 * 1000);
      });

      expect(getRecentTracks).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it("cleans up interval on unmount", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const successResult: GetRecentTracksResult = {
        status: "ok",
        tracks: [createMockTrack()],
      };

      const { unmount } = await act(() =>
        render(
          <RecentTracksList recentTracks={Promise.resolve(successResult)} />,
        ),
      );

      await act(async () => {
        vi.advanceTimersByTime(60 * 1000);
      });

      expect(getRecentTracks).toHaveBeenCalledTimes(1);

      unmount();

      await act(async () => {
        vi.advanceTimersByTime(60 * 1000);
      });

      // Should not have been called again after unmount
      expect(getRecentTracks).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });
});
