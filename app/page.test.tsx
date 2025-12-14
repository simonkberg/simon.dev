import { act, render, screen, waitFor, within } from "@testing-library/react";
import { use } from "react";
import { describe, expect, it, vi } from "vitest";

import { type ChatHistoryResult, getChatHistory } from "@/actions/chat";
import { getRecentTracks, type GetRecentTracksResult } from "@/actions/lastfm";
import { getWakaTimeStats, type WakaTimeStatsResult } from "@/actions/wakaTime";
import type { ChatProps } from "@/components/chat/Chat";
import type { RecentTracksListProps } from "@/components/RecentTracksList";
import type { StatsListProps } from "@/components/StatsList";
import { config } from "@/config";

import RootPage, { viewport } from "./page";

vi.mock("server-only", () => ({}));

vi.mock(import("@/actions/chat"), () => ({
  getChatHistory: vi.fn(() =>
    Promise.resolve<ChatHistoryResult>({ status: "ok", messages: [] }),
  ),
}));

vi.mock(import("@/actions/lastfm"), () => ({
  getRecentTracks: vi.fn(() =>
    Promise.resolve<GetRecentTracksResult>({ status: "ok", tracks: [] }),
  ),
}));

vi.mock(import("@/actions/wakaTime"), () => ({
  getWakaTimeStats: vi.fn(() =>
    Promise.resolve<WakaTimeStatsResult>({ status: "ok", stats: [] }),
  ),
}));

// Mock components that use() their promise props to trigger Suspense
vi.mock(import("@/components/chat/Chat"), () => ({
  Chat: ({ history }: ChatProps) => {
    use(history);
    return <div data-testid="chat" />;
  },
}));

vi.mock(import("@/components/RecentTracksList"), () => ({
  RecentTracksList: ({ recentTracks }: RecentTracksListProps) => {
    use(recentTracks);
    return <div data-testid="recent-tracks-list" />;
  },
}));

vi.mock(import("@/components/StatsList"), () => ({
  StatsList: ({ stats }: StatsListProps) => {
    use(stats);
    return <div data-testid="stats-list" />;
  },
}));

describe("viewport", () => {
  it("should have correct viewport configuration", () => {
    expect(viewport).toEqual({
      width: "device-width",
      initialScale: 1,
      viewportFit: "cover",
      themeColor: "black",
    });
  });
});

describe("RootPage", () => {
  describe("About section", () => {
    it("should be a labeled landmark region", async () => {
      await act(async () => render(<RootPage />));

      expect(screen.getByRole("region", { name: /About/ })).toBeInTheDocument();
    });

    it("should contain the description", async () => {
      await act(async () => render(<RootPage />));

      const region = screen.getByRole("region", { name: /About/ });
      expect(within(region).getByText(config.description)).toBeInTheDocument();
    });

    it("should contain location subtitle", async () => {
      await act(async () => render(<RootPage />));

      const region = screen.getByRole("region", { name: /About/ });
      expect(
        within(region).getByText(/Location: Stockholm, Sweden/),
      ).toBeInTheDocument();
    });

    it("should contain Spotify link", async () => {
      await act(async () => render(<RootPage />));

      const region = screen.getByRole("region", { name: /About/ });
      expect(
        within(region).getByRole("link", { name: "Spotify" }),
      ).toHaveAttribute("href", "https://twitter.com/SpotifyEng");
    });
  });

  describe("Currently writing section", () => {
    it("should be a labeled landmark region", async () => {
      await act(async () => render(<RootPage />));

      expect(
        screen.getByRole("region", { name: /Currently writing/ }),
      ).toBeInTheDocument();
    });

    it("should contain WakaTime link", async () => {
      await act(async () => render(<RootPage />));

      const region = screen.getByRole("region", { name: /Currently writing/ });
      expect(
        within(region).getByRole("link", { name: "WakaTime" }),
      ).toHaveAttribute("href", "https://wakatime.com/@simonkberg");
    });

    it("should show loader while stats are loading", async () => {
      const { promise, resolve } = Promise.withResolvers<WakaTimeStatsResult>();
      vi.mocked(getWakaTimeStats).mockReturnValue(promise);

      await act(async () => render(<RootPage />));

      const region = screen.getByRole("region", { name: /Currently writing/ });
      expect(within(region).getByRole("status")).toBeInTheDocument();
      expect(
        within(region).queryByTestId("stats-list"),
      ).not.toBeInTheDocument();

      act(() => resolve({ status: "ok", stats: [] }));

      await waitFor(() => {
        expect(within(region).queryByRole("status")).not.toBeInTheDocument();
        expect(within(region).getByTestId("stats-list")).toBeInTheDocument();
      });
    });
  });

  describe("Currently listening section", () => {
    it("should be a labeled landmark region", async () => {
      await act(async () => render(<RootPage />));

      expect(
        screen.getByRole("region", { name: /Currently listening to/ }),
      ).toBeInTheDocument();
    });

    it("should contain Last.fm link", async () => {
      await act(async () => render(<RootPage />));

      const region = screen.getByRole("region", {
        name: /Currently listening to/,
      });
      expect(
        within(region).getByRole("link", { name: "Last.fm" }),
      ).toHaveAttribute("href", "https://www.last.fm/user/magijo");
    });

    it("should contain link to listening statistics", async () => {
      await act(async () => render(<RootPage />));

      const region = screen.getByRole("region", {
        name: /Currently listening to/,
      });
      expect(
        within(region).getByRole("link", { name: "listening statistics" }),
      ).toHaveAttribute("href", "/listening");
    });

    it("should show loader while tracks are loading", async () => {
      const { promise, resolve } =
        Promise.withResolvers<GetRecentTracksResult>();
      vi.mocked(getRecentTracks).mockReturnValue(promise);

      await act(async () => render(<RootPage />));

      const region = screen.getByRole("region", {
        name: /Currently listening to/,
      });
      expect(within(region).getByRole("status")).toBeInTheDocument();
      expect(
        within(region).queryByTestId("recent-tracks-list"),
      ).not.toBeInTheDocument();

      act(() => resolve({ status: "ok", tracks: [] }));

      await waitFor(() => {
        expect(within(region).queryByRole("status")).not.toBeInTheDocument();
        expect(
          within(region).getByTestId("recent-tracks-list"),
        ).toBeInTheDocument();
      });
    });
  });

  describe("Links section", () => {
    it("should be a labeled landmark region", async () => {
      await act(async () => render(<RootPage />));

      expect(screen.getByRole("region", { name: /Links/ })).toBeInTheDocument();
    });

    it("should contain all config links", async () => {
      await act(async () => render(<RootPage />));

      const region = screen.getByRole("region", { name: /Links/ });
      for (const link of config.links) {
        expect(
          within(region).getByRole("link", { name: link.label }),
        ).toHaveAttribute("href", link.url);
      }
    });
  });

  describe("Chat section", () => {
    it("should be a labeled landmark region", async () => {
      await act(async () => render(<RootPage />));

      expect(screen.getByRole("region", { name: /Chat/ })).toBeInTheDocument();
    });

    it("should show loader while chat history is loading", async () => {
      const { promise, resolve } = Promise.withResolvers<ChatHistoryResult>();
      vi.mocked(getChatHistory).mockReturnValue(promise);

      await act(async () => render(<RootPage />));

      const region = screen.getByRole("region", { name: /^Chat/ });
      expect(within(region).getByRole("status")).toBeInTheDocument();
      expect(within(region).queryByTestId("chat")).not.toBeInTheDocument();

      act(() => resolve({ status: "ok", messages: [] }));

      await waitFor(() => {
        expect(within(region).queryByRole("status")).not.toBeInTheDocument();
        expect(within(region).getByTestId("chat")).toBeInTheDocument();
      });
    });
  });

  describe("Footer", () => {
    it("should contain Railway affiliate link", async () => {
      await act(async () => render(<RootPage />));

      const footer = screen.getByRole("contentinfo");
      expect(
        within(footer).getByRole("link", { name: "Railway" }),
      ).toHaveAttribute("href", "https://railway.com?referralCode=wzuAxn");
      expect(within(footer).getByText(/affiliate link/)).toBeInTheDocument();
    });
  });
});
