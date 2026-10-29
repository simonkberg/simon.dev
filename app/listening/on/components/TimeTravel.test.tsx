import { act, fireEvent, render, screen } from "@testing-library/react";
import { useParams } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BucketTopArtist, ScrobbleCount } from "@/actions/listening";
import type { Day } from "@/lib/dates";
import { monthBuckets } from "@/lib/scrobbleBuckets";
import { mockRouter } from "@/mocks/router";

import { MonthDays } from "./MonthDays";
import { TimeTravel, type TimeTravelProps } from "./TimeTravel";
import { TravelProvider } from "./Travel";

let navigation: ReturnType<typeof mockRouter>;

// The date in the URL, as the router gives it.
const at = (date: string) =>
  vi
    .mocked(useParams)
    .mockReturnValue({
      year: date.slice(0, 4),
      month: date.slice(5, 7),
      day: date.slice(8),
    });

vi.mock(import("next/navigation"), async (importOriginal) => ({
  ...(await importOriginal()),
  useParams: vi.fn(),
}));

beforeEach(() => {
  at("2012-10-14");
  navigation = mockRouter();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, months.length * 10, 72),
  );
});

const replace = () => navigation.navigate;

// December 2007 to October 2026, as the tape shows them.
const months: ScrobbleCount[] = monthBuckets(
  new Date("2026-10-28T12:00:00Z"),
).map(({ label }, index) => ({ label, count: index, current: false }));
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
  <navigation.Router>
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
  </navigation.Router>
);

const renderTape = (props: Partial<TimeTravelProps> = {}) =>
  act(async () => render(tape("2012-10-14", props)));

// The router moving to another day's page.
const arrive = async (rerender: (ui: React.ReactNode) => void, day: Day) => {
  at(day);
  await act(async () => {
    navigation.arrive();
    rerender(tape(day));
  });
};

// A followed link starts a navigation, which suspends until its page arrives.
const click = (element: HTMLElement, init?: MouseEventInit) =>
  act(async () => {
    fireEvent.click(element, init);
  });

// The slider moved by keys or assistive tech.
const slide = (month: number) =>
  act(async () => {
    fireEvent.change(screen.getByRole("slider", { name: "Month" }), {
      target: { value: String(month) },
    });
  });

// A pointer over a month on a tape ten pixels a month wide.
const press = (
  type: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel",
  month: number,
  button = 0,
) => {
  const tape = screen.getByRole("slider", { name: "Month" }).parentElement!;
  fireEvent[type](tape, { pointerId: 1, button, clientX: month * 10 + 5 });
};

// The month's days, which dim while the page travels to another month.
const pending = () =>
  screen.getByRole("list", { name: "Days" }).closest(".time-travel-pending");

describe("TimeTravel", () => {
  it("shows the day and its era", async () => {
    await renderTape();

    expect(screen.getByRole("status")).toHaveTextContent("Sun, Oct 14, 2012");
    expect(screen.getByText("era · The Magnetic Fields")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Month" })).toHaveValue(
      String(4 * 12 + 10),
    );
  });

  it("links the days around it", async () => {
    await renderTape();

    expect(screen.getByRole("link", { name: "Day before" })).toHaveAttribute(
      "href",
      "/listening/on/2012/10/13",
    );
    expect(screen.getByRole("link", { name: "Day after" })).toHaveAttribute(
      "href",
      "/listening/on/2012/10/15",
    );
  });

  it.each([
    ["2007-12-18", "Day before"],
    ["2026-10-28", "Day after"],
  ] as const)("on %s, has no %s", async (day, name) => {
    at(day);
    await act(async () => render(tape(day)));

    expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
  });

  it.each([
    [
      "a date the day's page turns away",
      { year: "2026", month: "10", day: "29" },
    ],
    ["no day's page", {}],
  ])("shows nothing for %s", async (_, params) => {
    vi.mocked(useParams).mockReturnValue(params);
    const { container } = await act(async () => render(tape("2012-10-14")));

    expect(container).toBeEmptyDOMElement();
  });

  it("travels to the month a drag stops at, keeping the date", async () => {
    vi.useFakeTimers();
    await renderTape();

    await slide(10);
    await slide(2);

    expect(screen.getByRole("status")).toHaveTextContent("Thu, Feb 14, 2008");
    expect(pending()).toHaveAttribute("data-pending");
    expect(replace()).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(replace()).toHaveBeenCalledExactlyOnceWith(
      "/listening/on/2008/02/14",
      { scroll: false },
    );
  });

  it("travels no earlier than the first scrobble", async () => {
    vi.useFakeTimers();
    await renderTape();

    await slide(0);

    expect(screen.getByRole("status")).toHaveTextContent("Tue, Dec 18, 2007");
  });

  it("marks each year at its January", async () => {
    const { container } = await renderTape();

    const years = container.querySelectorAll(".time-travel-years li");
    expect(years[0]).toHaveTextContent("08");
    expect(years[0]).toHaveStyle({ "--index": "1" });
  });

  it("scrubs as a press drags along the tape, and goes once let go", async () => {
    vi.useFakeTimers();
    await renderTape();

    press("pointerDown", 10);
    expect(screen.getByRole("slider", { name: "Month" })).toHaveFocus();
    press("pointerMove", 2);
    expect(screen.getByRole("status")).toHaveTextContent("Thu, Feb 14, 2008");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(replace()).not.toHaveBeenCalled();

    await act(async () => press("pointerUp", 2));
    expect(replace()).toHaveBeenCalledExactlyOnceWith(
      "/listening/on/2008/02/14",
      { scroll: false },
    );
  });

  it("goes nowhere when a press is let go on the day's month", async () => {
    await renderTape();

    press("pointerDown", 4 * 12 + 10);
    press("pointerUp", 4 * 12 + 10);

    expect(replace()).not.toHaveBeenCalled();
  });

  it("drops the scrub when the page takes the touch to scroll", async () => {
    await renderTape();
    press("pointerDown", 2);

    press("pointerCancel", 2);
    press("pointerUp", 2);

    expect(screen.getByRole("status")).toHaveTextContent("Sun, Oct 14, 2012");
    expect(replace()).not.toHaveBeenCalled();
  });

  it("ignores a press other than the main button", async () => {
    vi.useFakeTimers();
    await renderTape();

    press("pointerDown", 2, 2);
    press("pointerMove", 2);
    expect(screen.getByRole("status")).toHaveTextContent("Sun, Oct 14, 2012");

    // Nor does its release cut short a slide's wait.
    await slide(9);
    press("pointerUp", 2);
    expect(replace()).not.toHaveBeenCalled();
  });

  it("keeps the slider focused as the drag's page arrives", async () => {
    vi.useFakeTimers();
    const { rerender } = await renderTape();
    screen.getByRole("slider", { name: "Month" }).focus();
    await slide(2);

    await arrive(rerender, "2008-02-14");

    expect(screen.getByRole("slider", { name: "Month" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Thu, Feb 14, 2008");
    expect(pending()).not.toHaveAttribute("data-pending");
  });

  it("steps from the day a drag is on, instead of the drag", async () => {
    vi.useFakeTimers();
    await renderTape();

    await slide(2);
    const after = screen.getByRole("link", { name: "Day after" });
    expect(after).toHaveAttribute("href", "/listening/on/2008/02/15");
    await click(after);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByRole("status")).toHaveTextContent("Fri, Feb 15, 2008");
    expect(replace()).toHaveBeenCalledExactlyOnceWith(
      "/listening/on/2008/02/15",
      { scroll: false },
    );
  });

  it("moves to a clicked day before its page arrives, over a drag", async () => {
    vi.useFakeTimers();
    await renderTape();

    await slide(2);
    await click(screen.getByRole("link", { name: "Oct 1: 10 plays" }));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByRole("status")).toHaveTextContent("Mon, Oct 1, 2012");
    expect(
      screen.getByRole("link", { name: "Oct 1: 10 plays" }),
    ).toHaveAttribute("aria-current", "date");
    expect(replace()).toHaveBeenCalledExactlyOnceWith(
      "/listening/on/2012/10/01",
      { scroll: false },
    );
  });

  it("stays put when a day opens in a new tab", async () => {
    await renderTape();

    await click(screen.getByRole("link", { name: "Day after" }), {
      metaKey: true,
    });
    await click(screen.getByRole("link", { name: "Oct 1: 10 plays" }), {
      ctrlKey: true,
    });

    expect(screen.getByRole("status")).toHaveTextContent("Sun, Oct 14, 2012");
    expect(pending()).not.toHaveAttribute("data-pending");
  });

  it("lets go of a drag when a link to the shown day is clicked", async () => {
    vi.useFakeTimers();
    await renderTape();

    await slide(2);
    await click(screen.getByRole("link", { name: "Oct 14: 46 plays" }));

    expect(screen.getByRole("status")).toHaveTextContent("Sun, Oct 14, 2012");
    expect(pending()).not.toHaveAttribute("data-pending");
  });

  it("keeps a followed day's link focused as its page arrives", async () => {
    const { rerender } = await renderTape();
    const link = screen.getByRole("link", { name: "Oct 1: 10 plays" });
    link.focus();
    await click(link);

    await arrive(rerender, "2012-10-01");

    expect(screen.getByRole("link", { name: "Oct 1: 10 plays" })).toHaveFocus();
  });

  it("keeps a drag begun while the last one's day loads", async () => {
    vi.useFakeTimers();
    const { rerender } = await renderTape();
    await slide(2);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await slide(9);

    await arrive(rerender, "2008-02-14");
    expect(screen.getByRole("status")).toHaveTextContent("Sun, Sep 14, 2008");
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(replace()).toHaveBeenLastCalledWith("/listening/on/2008/09/14", {
      scroll: false,
    });
  });

  it("stays on the day when a drag returns while another loads", async () => {
    vi.useFakeTimers();
    await renderTape();
    await slide(2);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await slide(4 * 12 + 10);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(replace()).toHaveBeenLastCalledWith("/listening/on/2012/10/14", {
      scroll: false,
    });
    expect(screen.getByRole("status")).toHaveTextContent("Sun, Oct 14, 2012");
  });

  it("asks for nothing when a drag returns after a link to the shown day", async () => {
    vi.useFakeTimers();
    await renderTape();
    await click(screen.getByRole("link", { name: "Oct 14: 46 plays" }));

    await slide(2);
    await slide(4 * 12 + 10);
    await act(async () => vi.runAllTimers());

    expect(replace()).not.toHaveBeenCalled();
  });

  it("lets a day reached another way win over a drag", async () => {
    vi.useFakeTimers();
    const { rerender } = await renderTape();
    await slide(2);

    await arrive(rerender, "2012-10-13");
    await act(async () => vi.runAllTimers());

    expect(replace()).not.toHaveBeenCalled();
  });

  it("lets a day reached again another way win over a drag", async () => {
    vi.useFakeTimers();
    const { rerender } = await renderTape();
    await click(screen.getByRole("link", { name: "Oct 1: 10 plays" }));
    await arrive(rerender, "2012-10-01");
    await arrive(rerender, "2012-10-14");

    await slide(2);
    await arrive(rerender, "2012-10-01");
    await act(async () => vi.runAllTimers());

    expect(replace()).toHaveBeenCalledOnce();
  });

  it("keeps the date of a followed link's day while it loads", async () => {
    await renderTape();
    await click(screen.getByRole("link", { name: "Day after" }));

    await slide(2);

    expect(screen.getByRole("status")).toHaveTextContent("Fri, Feb 15, 2008");
  });

  it("stops a drag into this month at today", async () => {
    vi.useFakeTimers();
    at("2025-10-30");
    await act(async () => render(tape("2025-10-30")));

    await slide(months.length - 1);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(replace()).toHaveBeenCalledWith("/listening/on/2026/10/28", {
      scroll: false,
    });
  });

  it("settles back on the day when a drag returns to its month", async () => {
    vi.useFakeTimers();
    await renderTape();

    await slide(10);
    await slide(4 * 12 + 10);

    expect(pending()).not.toHaveAttribute("data-pending");
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(replace()).not.toHaveBeenCalled();
  });

  it("shows the first year's era from the tape's start", async () => {
    at("2007-12-20");
    await act(async () => render(tape("2007-12-20")));

    expect(screen.getByText("era · Stars")).toBeInTheDocument();
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
