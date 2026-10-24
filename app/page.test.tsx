import { act, render, screen, waitFor, within } from "@testing-library/react";
import { use } from "react";
import { describe, expect, it, vi } from "vitest";

import { type ChatHistoryResult, getChatHistory } from "@/actions/chat";
import {
  type GetOnThisDayResult,
  getRecentTracks,
  type GetRecentTracksResult,
} from "@/actions/lastfm";
import { getWakaTimeStats, type WakaTimeStatsResult } from "@/actions/wakaTime";
import type { ChatProps } from "@/components/chat/Chat";
import type { RecentTracksListProps } from "@/components/RecentTracksList";
import type { StatsListProps } from "@/components/StatsList";
import { config } from "@/config";
import { getChatTipDismissed } from "@/lib/chatTip";
import type { Username } from "@/lib/session";

import RootPage from "./page";

vi.mock(import("next/cache"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, io: vi.fn(async () => {}) };
});

vi.mock(import("@/actions/chat"), () => ({
  getChatHistory: vi.fn(() =>
    Promise.resolve<ChatHistoryResult>({ status: "ok", messages: [] }),
  ),
}));

vi.mock(import("@/lib/chatTip"), () => ({
  getChatTipDismissed: vi.fn(() => Promise.resolve(false)),
}));

vi.mock(import("@/lib/session"), () => ({
  getSession: vi.fn(() =>
    Promise.resolve({ username: "TestUser" as Username }),
  ),
}));

vi.mock(import("@/actions/lastfm"), () => ({
  getRecentTracks: vi.fn(() =>
    Promise.resolve<GetRecentTracksResult>({ status: "ok", tracks: [] }),
  ),
  getOnThisDay: vi.fn(() =>
    Promise.resolve<GetOnThisDayResult>({
      status: "ok",
      days: {
        date: "Oct 24",
        years: [{ year: "2012", count: 62, top: { artist: "A", track: "T" } }],
      },
    }),
  ),
}));

vi.mock(import("@/actions/wakaTime"), () => ({
  getWakaTimeStats: vi.fn(() =>
    Promise.resolve<WakaTimeStatsResult>({ status: "ok", stats: [] }),
  ),
}));

// Mock components that use() their promise props to trigger Suspense
vi.mock(import("@/components/chat/Chat"), () => ({
  Chat: ({ history, tipDismissed }: ChatProps) => {
    const result = use(history);
    return (
      <div
        data-testid="chat"
        data-status={result.status}
        data-tip-dismissed={use(tipDismissed)}
      />
    );
  },
}));

vi.mock(import("@/components/chat/ChatStream"), () => ({
  ChatStream: () => <span role="status">live</span>,
}));

vi.mock(import("@/components/RecentTracksList"), () => ({
  RecentTracksList: ({ recentTracks }: RecentTracksListProps) => {
    use(recentTracks);
    return <div data-testid="recent-tracks-list" />;
  },
}));

vi.mock(import("@/components/StatsList"), async (importOriginal) => ({
  ...(await importOriginal()),
  StatsList: ({ stats }: StatsListProps) => {
    use(stats);
    return <div data-testid="stats-list" />;
  },
}));

const renderPage = () => act(async () => render(<RootPage />));

const region = (name: RegExp) => screen.getByRole("region", { name });

describe("RootPage", () => {
  describe("About section", () => {
    it("should contain the description", async () => {
      await renderPage();

      const section = region(/About/);
      expect(within(section).getByText(config.description)).toBeInTheDocument();
    });

    it("should contain location subtitle", async () => {
      await renderPage();

      const section = region(/About/);
      expect(
        within(section).getByText(/Location: Stockholm, Sweden/),
      ).toBeInTheDocument();
    });

    it("should contain Spotify link", async () => {
      await renderPage();

      const section = region(/About/);
      expect(
        within(section).getByRole("link", { name: "Spotify" }),
      ).toHaveAttribute("href", "https://twitter.com/SpotifyEng");
    });
  });

  describe("Currently writing section", () => {
    it("should contain WakaTime link", async () => {
      await renderPage();

      const section = region(/Currently writing/);
      expect(
        within(section).getByRole("link", { name: "WakaTime" }),
      ).toHaveAttribute("href", "https://wakatime.com/@simonkberg");
    });

    it("should show loader while stats are loading", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { promise, resolve } = Promise.withResolvers<WakaTimeStatsResult>();
      vi.mocked(getWakaTimeStats).mockReturnValue(promise);

      await renderPage();

      const section = region(/Currently writing/);
      expect(within(section).getByRole("status")).toBeInTheDocument();
      expect(
        within(section).queryByTestId("stats-list"),
      ).not.toBeInTheDocument();

      await act(async () => {
        resolve({ status: "ok", stats: [] });
        // Skip React's Suspense throttling delay
        await vi.advanceTimersByTimeAsync(300);
      });

      await waitFor(() => {
        expect(within(section).queryByRole("status")).not.toBeInTheDocument();
        expect(within(section).getByTestId("stats-list")).toBeInTheDocument();
      });
    });
  });

  describe("Currently listening section", () => {
    it("should contain Last.fm link", async () => {
      await renderPage();

      const section = region(/Currently listening to/);
      expect(
        within(section).getByRole("link", { name: "Last.fm" }),
      ).toHaveAttribute("href", "https://www.last.fm/user/magijo");
    });

    it("should contain link to listening statistics", async () => {
      await renderPage();

      const section = region(/Currently listening to/);
      expect(
        within(section).getByRole("link", { name: "listening statistics" }),
      ).toHaveAttribute("href", "/listening");
    });

    it("should link this day's busiest past year to every year", async () => {
      await renderPage();

      const section = region(/Currently listening to/);
      expect(within(section).getByText(/On this day in 2012/)).toBeVisible();
      expect(
        within(section).getByRole("link", { name: "every\u00a0year" }),
      ).toHaveAttribute("href", "/listening/on-this-day");
    });

    it("should show loader while tracks are loading", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { promise, resolve } =
        Promise.withResolvers<GetRecentTracksResult>();
      vi.mocked(getRecentTracks).mockReturnValue(promise);

      await renderPage();

      const section = region(/Currently listening to/);
      expect(within(section).getByRole("status")).toBeInTheDocument();
      expect(
        within(section).queryByTestId("recent-tracks-list"),
      ).not.toBeInTheDocument();

      await act(async () => {
        resolve({ status: "ok", tracks: [] });
        // Skip React's Suspense throttling delay
        await vi.advanceTimersByTimeAsync(300);
      });

      await waitFor(() => {
        expect(within(section).queryByRole("status")).not.toBeInTheDocument();
        expect(
          within(section).getByTestId("recent-tracks-list"),
        ).toBeInTheDocument();
      });
    });
  });

  describe("Links section", () => {
    it("should contain all config links", async () => {
      await renderPage();

      const section = region(/Links/);
      for (const link of config.links) {
        expect(
          within(section).getByRole("link", { name: link.label }),
        ).toHaveAttribute("href", link.url);
      }
    });
  });

  describe("Chat section", () => {
    it("should pass whether the tip has been dismissed", async () => {
      vi.mocked(getChatTipDismissed).mockResolvedValueOnce(true);

      await renderPage();

      expect(screen.getByTestId("chat")).toHaveAttribute(
        "data-tip-dismissed",
        "true",
      );
    });

    it("should pass a failed history through", async () => {
      vi.mocked(getChatHistory).mockResolvedValueOnce({
        status: "error",
        error: "Failed",
      });

      await renderPage();

      expect(screen.getByTestId("chat")).toHaveAttribute(
        "data-status",
        "error",
      );
    });

    it("should show loader while chat history is loading", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { promise, resolve } = Promise.withResolvers<ChatHistoryResult>();
      vi.mocked(getChatHistory).mockReturnValue(promise);

      await renderPage();

      const section = region(/^Chat/);
      expect(within(section).getByText("Loading")).toBeInTheDocument();
      expect(within(section).queryByTestId("chat")).not.toBeInTheDocument();

      await act(async () => {
        resolve({ status: "ok", messages: [] });
        // Skip React's Suspense throttling delay
        await vi.advanceTimersByTimeAsync(300);
      });

      await waitFor(() => {
        expect(within(section).queryByText("Loading")).not.toBeInTheDocument();
        expect(within(section).getByTestId("chat")).toBeInTheDocument();
      });
    });
  });
});
