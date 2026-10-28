import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BucketTopArtist, ScrobbleCount } from "@/actions/listening";
import type { Day } from "@/lib/dates";

import { TimeTravel, type TimeTravelProps } from "./TimeTravel";

const replace = vi.fn();

vi.mock(import("next/navigation"), () => ({ useRouter: vi.fn() }));

beforeEach(() => {
  vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<
    typeof useRouter
  >);
});

const monthLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

// January 2007 to October 2026, as the tape shows them.
const months: ScrobbleCount[] = Array.from(
  { length: 19 * 12 + 10 },
  (_, index) => ({
    label: monthLabel.format(new Date(Date.UTC(2007, index, 1))),
    count: index,
    current: false,
  }),
);
const years: BucketTopArtist[] = Array.from({ length: 20 }, (_, index) => ({
  label: String(2007 + index),
  artist: {
    name: index === 4 || index === 5 ? "The Magnetic Fields" : "Stars",
    playcount: 1,
  },
}));
const october: ScrobbleCount[] = Array.from({ length: 31 }, (_, index) => ({
  label: `Oct ${index + 1}`,
  count: index === 13 ? 46 : 10,
  current: false,
}));

const renderTape = (
  day: Day = "2012-10-14",
  props: Partial<TimeTravelProps> = {},
) =>
  act(async () =>
    render(
      <TimeTravel
        day={day}
        today="2026-10-28"
        months={Promise.resolve(months)}
        years={Promise.resolve(years)}
        days={Promise.resolve(october)}
        {...props}
      />,
    ),
  );

describe("TimeTravel", () => {
  it("shows the day, its plays and its era", async () => {
    await renderTape();

    expect(screen.getByRole("status")).toHaveTextContent("Sun, Oct 14, 2012");
    expect(screen.getByText("46 plays")).toBeInTheDocument();
    expect(screen.getByText("era · The Magnetic Fields")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Month" })).toHaveValue(
      String(5 * 12 + 9),
    );
  });

  it("links the days around it and every other day of its month", async () => {
    await renderTape();

    expect(screen.getByRole("link", { name: "Day before" })).toHaveAttribute(
      "href",
      "/listening/on/2012-10-13",
    );
    expect(screen.getByRole("link", { name: "Day after" })).toHaveAttribute(
      "href",
      "/listening/on/2012-10-15",
    );
    expect(
      screen.getByRole("link", { name: "Oct 1: 10 plays" }),
    ).toHaveAttribute("href", "/listening/on/2012-10-01");
    expect(
      screen.getByRole("link", { name: "Oct 14: 46 plays" }),
    ).toHaveAttribute("aria-current", "date");
  });

  it("keeps a followed day focused as its page arrives", async () => {
    const props = {
      today: "2026-10-28",
      months: Promise.resolve(months),
      years: Promise.resolve(years),
      days: Promise.resolve(october),
    } as const;
    const { rerender } = await act(async () =>
      render(<TimeTravel day="2012-10-14" {...props} />),
    );
    screen.getByRole("link", { name: "Oct 1: 10 plays" }).focus();

    await act(async () => rerender(<TimeTravel day="2012-10-01" {...props} />));

    expect(screen.getByRole("link", { name: "Oct 1: 10 plays" })).toHaveFocus();
  });

  it.each([
    ["2007-01-01", "Day before"],
    ["2026-10-28", "Day after"],
  ] as const)("on %s, has no %s", async (day, name) => {
    await renderTape(day);

    expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
  });

  it("travels to the month a drag stops at, keeping the date", async () => {
    vi.useFakeTimers();
    await renderTape();

    const slider = screen.getByRole("slider", { name: "Month" });
    fireEvent.change(slider, { target: { value: "10" } });
    fireEvent.change(slider, { target: { value: "13" } });

    expect(screen.getByRole("status")).toHaveTextContent("Thu, Feb 14, 2008");
    expect(screen.queryByText("46 plays")).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(replace).toHaveBeenCalledExactlyOnceWith(
      "/listening/on/2008-02-14",
      { scroll: false },
    );
  });

  it("steps from the day a drag is on, instead of the drag", async () => {
    vi.useFakeTimers();
    await renderTape();

    fireEvent.change(screen.getByRole("slider", { name: "Month" }), {
      target: { value: "13" },
    });
    const after = screen.getByRole("link", { name: "Day after" });
    fireEvent.click(after);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(after).toHaveAttribute("href", "/listening/on/2008-02-15");
    expect(replace).not.toHaveBeenCalled();
  });

  it("lets a clicked day win over a drag", async () => {
    vi.useFakeTimers();
    await renderTape();

    fireEvent.change(screen.getByRole("slider", { name: "Month" }), {
      target: { value: "13" },
    });
    fireEvent.click(screen.getByRole("link", { name: "Oct 1: 10 plays" }));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps the slider focused as the drag's page arrives", async () => {
    vi.useFakeTimers();
    const props = {
      today: "2026-10-28",
      months: Promise.resolve(months),
      years: Promise.resolve(years),
      days: Promise.resolve(october),
    } as const;
    const { rerender } = await act(async () =>
      render(<TimeTravel day="2012-10-14" {...props} />),
    );
    const slider = screen.getByRole("slider", { name: "Month" });
    slider.focus();
    fireEvent.change(slider, { target: { value: "13" } });

    await act(async () => rerender(<TimeTravel day="2008-02-14" {...props} />));

    expect(screen.getByRole("slider", { name: "Month" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Thu, Feb 14, 2008");
    expect(
      screen.getByRole("slider", { name: "Month" }).closest(".time-travel"),
    ).not.toHaveAttribute("data-scrubbing");
  });

  it("lets a day reached another way win over a drag", async () => {
    vi.useFakeTimers();
    const props = {
      today: "2026-10-28",
      months: Promise.resolve(months),
      years: Promise.resolve(years),
      days: Promise.resolve(october),
    } as const;
    const { rerender } = await act(async () =>
      render(<TimeTravel day="2012-10-14" {...props} />),
    );
    fireEvent.change(screen.getByRole("slider", { name: "Month" }), {
      target: { value: "13" },
    });

    await act(async () => rerender(<TimeTravel day="2012-10-13" {...props} />));
    await act(async () => vi.runAllTimers());

    expect(replace).not.toHaveBeenCalled();
  });

  it("stops a drag into this month at today", async () => {
    vi.useFakeTimers();
    await renderTape("2025-10-30");

    fireEvent.change(screen.getByRole("slider", { name: "Month" }), {
      target: { value: String(months.length - 1) },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(replace).toHaveBeenCalledWith("/listening/on/2026-10-28", {
      scroll: false,
    });
  });

  it("settles back on the day when a drag returns to its month", async () => {
    vi.useFakeTimers();
    await renderTape();

    const slider = screen.getByRole("slider", { name: "Month" });
    fireEvent.change(slider, { target: { value: "10" } });
    fireEvent.change(slider, { target: { value: String(5 * 12 + 9) } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText("46 plays")).toBeInTheDocument();
  });

  it("shows no era for a year without scrobbles", async () => {
    await renderTape("2012-10-14", {
      years: Promise.resolve(
        years.map((year, index) =>
          index === 5 ? { ...year, artist: undefined } : year,
        ),
      ),
    });

    expect(screen.queryByText(/^era ·/)).not.toBeInTheDocument();
  });

  it("shows no era when the years failed to load", async () => {
    await renderTape("2012-10-14", { years: Promise.resolve(undefined) });

    expect(screen.queryByText(/^era ·/)).not.toBeInTheDocument();
  });

  it("says the days are unavailable when they failed to load", async () => {
    await renderTape("2012-10-14", { days: Promise.resolve(undefined) });

    expect(
      screen.getByText("This month’s days are temporarily unavailable :("),
    ).toBeInTheDocument();
  });

  it("says time travel is unavailable without the tape", async () => {
    await renderTape("2012-10-14", { months: Promise.resolve(undefined) });

    expect(
      screen.getByText("Time travel is temporarily unavailable :("),
    ).toBeInTheDocument();
  });
});
