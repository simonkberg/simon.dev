import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { tap } from "@/mocks/popover";

import { RelativeTime } from "./RelativeTime";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("RelativeTime", () => {
  let now: number;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    now = Date.now();
  });

  it("renders a time element with the full date in a tooltip", async () => {
    const testDate = new Date(now - 5 * MINUTE);

    await act(() => render(<RelativeTime date={testDate} />));
    const timeElement = screen.getByText(/5 minutes ago/);
    await tap(timeElement);

    expect(timeElement).toHaveAttribute("dateTime", testDate.toISOString());
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      testDate.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    );
  });

  it.each([
    { offset: 30 * 1000, expected: /30 seconds ago/ },
    { offset: 30 * MINUTE, expected: /30 minutes ago/ },
    { offset: 5 * HOUR, expected: /5 hours ago/ },
    { offset: 5 * DAY, expected: /5 days ago/ },
    { offset: 60 * DAY, expected: /2 months ago/ },
    { offset: 2 * 365 * DAY, expected: /2 years ago/ },
  ])("displays $expected", async ({ offset, expected }) => {
    await act(() => render(<RelativeTime date={new Date(now - offset)} />));

    expect(screen.getByText(expected)).toBeInTheDocument();
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
      initialOffset: 5 * MINUTE,
      advanceBy: MINUTE,
      initialText: /5 minutes ago/,
      updatedText: /6 minutes ago/,
      description: "1 minute for times under an hour",
    },
    {
      initialOffset: 2 * HOUR + 28 * MINUTE,
      advanceBy: 5 * MINUTE,
      initialText: /2 hours ago/,
      updatedText: /3 hours ago/,
      description: "5 minutes for times under a day",
    },
  ])(
    "updates display after $description",
    async ({ initialOffset, advanceBy, initialText, updatedText }) => {
      await act(() =>
        render(<RelativeTime date={new Date(now - initialOffset)} />),
      );

      expect(screen.getByText(initialText)).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(advanceBy);
      });

      expect(screen.getByText(updatedText)).toBeInTheDocument();
    },
  );

  it.each([
    { style: "short" as const, expected: /5 min. ago/ },
    { style: "narrow" as const, expected: /5m ago/ },
  ])('formats with "$style" style', async ({ style, expected }) => {
    await act(() =>
      render(<RelativeTime date={new Date(now - 5 * MINUTE)} style={style} />),
    );

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("updates formatter when style prop changes", async () => {
    const date = new Date(now - 5 * MINUTE);

    const { rerender } = await act(() =>
      render(<RelativeTime date={date} style="long" />),
    );

    expect(screen.getByText(/5 minutes ago/)).toBeInTheDocument();

    await act(async () => {
      rerender(<RelativeTime date={date} style="narrow" />);
    });

    expect(screen.getByText(/5m ago/)).toBeInTheDocument();
  });

  it("hydrates over the server's text and then shows its own", async () => {
    const date = new Date(now - 5 * MINUTE);
    const container = document.createElement("div");
    container.innerHTML = renderToString(<RelativeTime date={date} />);
    document.body.append(container);
    vi.setSystemTime(now + MINUTE);
    const onRecoverableError = vi.fn();

    await act(async () => {
      render(<RelativeTime date={date} />, {
        container,
        hydrate: true,
        onRecoverableError,
      });
    });

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container).toHaveTextContent("6 minutes ago");
  });

  it("does not update display for times older than a day", async () => {
    await act(() => render(<RelativeTime date={new Date(now - 2 * DAY)} />));

    expect(screen.getByText(/2 days ago/)).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });
});
