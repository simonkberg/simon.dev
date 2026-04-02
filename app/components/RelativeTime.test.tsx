import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RelativeTime } from "./RelativeTime";

describe("RelativeTime", () => {
  it("renders semantic time element with correct attributes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const now = Date.now();
    vi.setSystemTime(now);

    const testDate = new Date(now - 5 * 60 * 1000);

    await act(() => render(<RelativeTime date={testDate} />));

    const timeElement = screen.getByText(/5 minutes ago/).closest("time");
    expect(timeElement).toHaveAttribute("dateTime", testDate.toISOString());
    expect(timeElement).toHaveAttribute("title", testDate.toLocaleString());

    vi.useRealTimers();
  });

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

    await act(() => render(<RelativeTime date={new Date(now - offset)} />));

    expect(screen.getByText(expected)).toBeInTheDocument();

    vi.useRealTimers();
  });

  it.each([
    {
      initialOffset: 30 * 1000,
      advanceBy: 1000,
      initialText: /30 seconds ago/,
      updatedText: /31 seconds ago/,
      description: "1 second for recent times",
    },
    {
      initialOffset: 5 * 60 * 1000,
      advanceBy: 60 * 1000,
      initialText: /5 minutes ago/,
      updatedText: /6 minutes ago/,
      description: "1 minute for times under an hour",
    },
    {
      initialOffset: 2 * 60 * 60 * 1000,
      advanceBy: 5 * 60 * 1000,
      initialText: /2 hours ago/,
      updatedText: /2 hours ago/,
      description: "5 minutes for times under a day (no visible change)",
    },
  ])(
    "updates display after $description",
    async ({ initialOffset, advanceBy, initialText, updatedText }) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const now = Date.now();
      vi.setSystemTime(now);

      await act(() =>
        render(<RelativeTime date={new Date(now - initialOffset)} />),
      );

      expect(screen.getByText(initialText)).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(advanceBy);
      });

      expect(screen.getByText(updatedText)).toBeInTheDocument();

      vi.useRealTimers();
    },
  );

  it("uses long style by default", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const now = Date.now();
    vi.setSystemTime(now);

    await act(() =>
      render(<RelativeTime date={new Date(now - 5 * 60 * 1000)} />),
    );

    // "long" style produces full words like "5 minutes ago"
    expect(screen.getByText(/5 minutes ago/)).toBeInTheDocument();

    vi.useRealTimers();
  });

  it.each([
    { style: "short" as const, expected: /5 min. ago/, description: "short" },
    { style: "narrow" as const, expected: /5m ago/, description: "narrow" },
  ])('formats with "$description" style', async ({ style, expected }) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const now = Date.now();
    vi.setSystemTime(now);

    await act(() =>
      render(
        <RelativeTime date={new Date(now - 5 * 60 * 1000)} style={style} />,
      ),
    );

    expect(screen.getByText(expected)).toBeInTheDocument();

    vi.useRealTimers();
  });

  it("updates formatter when style prop changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const now = Date.now();
    vi.setSystemTime(now);

    const date = new Date(now - 5 * 60 * 1000);

    const { rerender } = await act(() =>
      render(<RelativeTime date={date} style="long" />),
    );

    expect(screen.getByText(/5 minutes ago/)).toBeInTheDocument();

    await act(() => rerender(<RelativeTime date={date} style="narrow" />));

    expect(screen.getByText(/5m ago/)).toBeInTheDocument();

    vi.useRealTimers();
  });

  it("does not update display for times older than a day", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const now = Date.now();
    vi.setSystemTime(now);

    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);

    await act(() => render(<RelativeTime date={twoDaysAgo} />));

    expect(screen.getByText(/2 days ago/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    expect(screen.getByText(/2 days ago/)).toBeInTheDocument();

    vi.useRealTimers();
  });
});
