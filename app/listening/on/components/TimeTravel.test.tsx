import { act, fireEvent, render, screen } from "@testing-library/react";
import { useParams, useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BucketTopArtist, ScrobbleCount } from "@/actions/listening";
import type { Day } from "@/lib/dates";

import { MonthDays } from "./MonthDays";
import { TimeTravel, type TimeTravelProps } from "./TimeTravel";
import { TravelProvider } from "./Travel";

const replace = vi.fn();

// The date in the URL, as the router gives it.
const at = (date: string) =>
  vi
    .mocked(useParams)
    .mockReturnValue({ month: date.slice(0, 7), day: date.slice(8) });

vi.mock(import("next/navigation"), () => ({
  useParams: vi.fn(),
  useRouter: vi.fn(),
}));

beforeEach(() => {
  at("2012-10-14");
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

// The tape with the day's month under it, as the layout and its slot render them.
const tape = (day: Day, props: Partial<TimeTravelProps> = {}) => (
  <TravelProvider>
    <TimeTravel
      today={Promise.resolve("2026-10-28")}
      months={Promise.resolve(months)}
      years={Promise.resolve(years)}
      {...props}
    >
      {/* Keyed as each month's layout is its own. */}
      <MonthDays key={day.slice(0, 7)} month="2012-10" days={october} />
    </TimeTravel>
  </TravelProvider>
);

const renderTape = (props: Partial<TimeTravelProps> = {}) =>
  act(async () => render(tape("2012-10-14", props)));

// The router moving to another day's page.
const arrive = async (rerender: (ui: React.ReactNode) => void, day: Day) => {
  at(day);
  await act(async () => rerender(tape(day)));
};

const drag = (month: number) =>
  fireEvent.change(screen.getByRole("slider", { name: "Month" }), {
    target: { value: String(month) },
  });

// The month's days, which dim while the page travels to another month.
const pending = () =>
  screen.getByRole("list", { name: "Days" }).closest(".time-travel-pending");

describe("TimeTravel", () => {
  it("shows the day and its era", async () => {
    await renderTape();

    expect(screen.getByRole("status")).toHaveTextContent("Sun, Oct 14, 2012");
    expect(screen.getByText("era · The Magnetic Fields")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Month" })).toHaveValue(
      String(5 * 12 + 9),
    );
  });

  it("links the days around it", async () => {
    await renderTape();

    expect(screen.getByRole("link", { name: "Day before" })).toHaveAttribute(
      "href",
      "/listening/on/2012-10-13",
    );
    expect(screen.getByRole("link", { name: "Day after" })).toHaveAttribute(
      "href",
      "/listening/on/2012-10-15",
    );
  });

  it.each([
    ["2007-01-01", "Day before"],
    ["2026-10-28", "Day after"],
  ] as const)("on %s, has no %s", async (day, name) => {
    at(day);
    await act(async () => render(tape(day)));

    expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
  });

  it.each([
    ["a date the day's page turns away", { month: "2026-10", day: "29" }],
    ["no day's page", {}],
  ])("shows nothing for %s", async (_, params) => {
    vi.mocked(useParams).mockReturnValue(params);
    const { container } = await act(async () => render(tape("2012-10-14")));

    expect(container).toBeEmptyDOMElement();
  });

  it("travels to the month a drag stops at, keeping the date", async () => {
    vi.useFakeTimers();
    await renderTape();

    drag(10);
    drag(13);

    expect(screen.getByRole("status")).toHaveTextContent("Thu, Feb 14, 2008");
    expect(pending()).toHaveAttribute("data-pending");
    expect(replace).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(replace).toHaveBeenCalledExactlyOnceWith(
      "/listening/on/2008-02-14",
      { scroll: false },
    );
  });

  it("waits for a held drag to be let go, wherever that is", async () => {
    vi.useFakeTimers();
    await renderTape();
    fireEvent.pointerDown(screen.getByRole("slider", { name: "Month" }));

    drag(13);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(replace).not.toHaveBeenCalled();

    fireEvent.pointerUp(window);
    expect(replace).toHaveBeenCalledExactlyOnceWith(
      "/listening/on/2008-02-14",
      { scroll: false },
    );
  });

  it("forgets a held drag when the tape goes away", async () => {
    vi.useFakeTimers();
    const { unmount } = await renderTape();
    fireEvent.pointerDown(screen.getByRole("slider", { name: "Month" }));
    drag(13);

    unmount();
    fireEvent.pointerUp(window);

    expect(replace).not.toHaveBeenCalled();
  });

  it("doesn't wait for a press other than the main button", async () => {
    vi.useFakeTimers();
    await renderTape();
    fireEvent.pointerDown(screen.getByRole("slider", { name: "Month" }), {
      button: 2,
    });

    drag(13);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(replace).toHaveBeenCalledOnce();
  });

  it("keeps the slider focused as the drag's page arrives", async () => {
    vi.useFakeTimers();
    const { rerender } = await renderTape();
    screen.getByRole("slider", { name: "Month" }).focus();
    drag(13);

    await arrive(rerender, "2008-02-14");

    expect(screen.getByRole("slider", { name: "Month" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Thu, Feb 14, 2008");
    expect(pending()).not.toHaveAttribute("data-pending");
  });

  it("steps from the day a drag is on, instead of the drag", async () => {
    vi.useFakeTimers();
    await renderTape();

    drag(13);
    const after = screen.getByRole("link", { name: "Day after" });
    expect(after).toHaveAttribute("href", "/listening/on/2008-02-15");
    fireEvent.click(after);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByRole("status")).toHaveTextContent("Fri, Feb 15, 2008");
    expect(replace).not.toHaveBeenCalled();
  });

  it("moves to a clicked day before its page arrives, over a drag", async () => {
    vi.useFakeTimers();
    await renderTape();

    drag(13);
    fireEvent.click(screen.getByRole("link", { name: "Oct 1: 10 plays" }));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByRole("status")).toHaveTextContent("Mon, Oct 1, 2012");
    expect(
      screen.getByRole("link", { name: "Oct 1: 10 plays" }),
    ).toHaveAttribute("aria-current", "date");
    expect(replace).not.toHaveBeenCalled();
  });

  it("stays put when a day opens in a new tab", async () => {
    await renderTape();

    fireEvent.click(screen.getByRole("link", { name: "Day after" }), {
      metaKey: true,
    });
    fireEvent.click(screen.getByRole("link", { name: "Oct 1: 10 plays" }), {
      ctrlKey: true,
    });

    expect(screen.getByRole("status")).toHaveTextContent("Sun, Oct 14, 2012");
    expect(pending()).not.toHaveAttribute("data-pending");
  });

  it("lets go of a drag when a link to the shown day is clicked", async () => {
    vi.useFakeTimers();
    await renderTape();

    drag(13);
    fireEvent.click(screen.getByRole("link", { name: "Oct 14: 46 plays" }));

    expect(screen.getByRole("status")).toHaveTextContent("Sun, Oct 14, 2012");
    expect(pending()).not.toHaveAttribute("data-pending");
  });

  it("focuses a followed day's link on its new page", async () => {
    const { rerender } = await renderTape();
    const link = screen.getByRole("link", { name: "Oct 1: 10 plays" });
    link.focus();
    fireEvent.click(link);

    await arrive(rerender, "2012-10-01");

    expect(screen.getByRole("link", { name: "Oct 1: 10 plays" })).toHaveFocus();
  });

  it("leaves focus alone when a drag overtakes a followed link", async () => {
    vi.useFakeTimers();
    const { rerender } = await renderTape();
    const link = screen.getByRole("link", { name: "Oct 1: 10 plays" });
    link.focus();
    fireEvent.click(link);
    drag(13);
    link.blur();

    await arrive(rerender, "2012-10-01");

    expect(document.body).toHaveFocus();
  });

  it("leaves focus alone when a day's link is clicked unfocused", async () => {
    const { rerender } = await renderTape();
    fireEvent.click(screen.getByRole("link", { name: "Oct 1: 10 plays" }));

    await arrive(rerender, "2012-10-01");

    expect(document.body).toHaveFocus();
  });

  it("keeps a drag begun while the last one's day loads", async () => {
    vi.useFakeTimers();
    const { rerender } = await renderTape();
    drag(13);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    drag(20);

    await arrive(rerender, "2008-02-14");
    expect(screen.getByRole("status")).toHaveTextContent("Sun, Sep 14, 2008");
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(replace).toHaveBeenLastCalledWith("/listening/on/2008-09-14", {
      scroll: false,
    });
  });

  it("stays on the day when a drag returns while another loads", async () => {
    vi.useFakeTimers();
    await renderTape();
    drag(13);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    drag(5 * 12 + 9);

    expect(replace).toHaveBeenLastCalledWith("/listening/on/2012-10-14", {
      scroll: false,
    });
    expect(screen.getByRole("status")).toHaveTextContent("Sun, Oct 14, 2012");
  });

  it("asks for nothing when a drag returns after a link to the shown day", async () => {
    vi.useFakeTimers();
    await renderTape();
    fireEvent.click(screen.getByRole("link", { name: "Oct 14: 46 plays" }));

    drag(13);
    drag(5 * 12 + 9);
    await act(async () => vi.runAllTimers());

    expect(replace).not.toHaveBeenCalled();
  });

  it("lets a day reached another way win over a drag", async () => {
    vi.useFakeTimers();
    const { rerender } = await renderTape();
    drag(13);

    await arrive(rerender, "2012-10-13");
    await act(async () => vi.runAllTimers());

    expect(replace).not.toHaveBeenCalled();
  });

  it("stops a drag into this month at today", async () => {
    vi.useFakeTimers();
    at("2025-10-30");
    await act(async () => render(tape("2025-10-30")));

    drag(months.length - 1);
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

    drag(10);
    drag(5 * 12 + 9);

    expect(pending()).not.toHaveAttribute("data-pending");
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows no era for a year without scrobbles", async () => {
    await renderTape({
      years: Promise.resolve(
        years.map((year, index) =>
          index === 5 ? { ...year, artist: undefined } : year,
        ),
      ),
    });

    expect(screen.queryByText(/^era ·/)).not.toBeInTheDocument();
  });

  it("shows no era when the years failed to load", async () => {
    await renderTape({ years: Promise.resolve(undefined) });

    expect(screen.queryByText(/^era ·/)).not.toBeInTheDocument();
  });

  it("says time travel is unavailable without the tape", async () => {
    await renderTape({ months: Promise.resolve(undefined) });

    expect(
      screen.getByText("Time travel is temporarily unavailable :("),
    ).toBeInTheDocument();
  });
});
