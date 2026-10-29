import { describe, expect, it } from "vitest";

import {
  addDays,
  clockTime,
  dayIndex,
  dayInMonth,
  firstOfMonth,
  dayStart,
  fullDayLabel,
  monthIndex,
  monthLabel,
  monthOf,
  nextMidnight,
  parseDay,
  todayLabel,
  yearBefore,
} from "./dates";

describe("nextMidnight", () => {
  it("should find tomorrow's start across a clock change", () => {
    // Stockholm leaves summer time on 2026-10-25.
    expect(nextMidnight(new Date("2026-10-25T12:00:00Z"))).toEqual(
      new Date("2026-10-25T23:00:00Z"),
    );
  });
});

describe("todayLabel", () => {
  it("should name Stockholm's day once UTC is still on the one before", () => {
    expect(todayLabel(new Date("2026-10-25T23:30:00Z"))).toBe(
      "Monday 2026-10-26",
    );
  });
});

describe("clockTime", () => {
  it("should read Stockholm's wall clock", () => {
    expect(clockTime(new Date("2026-07-01T22:30:00Z"))).toBe(
      "2026-07-02 00:30",
    );
  });
});

describe("dayStart", () => {
  it("should give a day's Stockholm midnight, or one `offset` days on", () => {
    expect(dayStart("2015-12-24")).toEqual(new Date("2015-12-23T23:00:00Z"));
    expect(dayStart("2015-12-31", 1)).toEqual(new Date("2015-12-31T23:00:00Z"));
  });

  it("should follow daylight saving time", () => {
    expect(dayStart("2026-03-29", 1)).toEqual(new Date("2026-03-29T22:00:00Z"));
  });
});

describe("parseDay", () => {
  it("should take a calendar date", () => {
    expect(parseDay("2012-10-14")).toBe("2012-10-14");
  });

  it.each(["2012-10-14x", "2012-1-14", "2012-02-30", "today"])(
    "should refuse %s",
    (value) => {
      expect(parseDay(value)).toBeUndefined();
    },
  );
});

describe("addDays", () => {
  it("should step across months", () => {
    expect(addDays("2012-10-31", 1)).toBe("2012-11-01");
    expect(addDays("2012-03-01", -1)).toBe("2012-02-29");
  });
});

describe("yearBefore", () => {
  it("should keep the date", () => {
    expect(yearBefore("2026-10-28")).toBe("2025-10-28");
  });

  it("should move February 29 to March 1", () => {
    expect(yearBefore("2028-02-29")).toBe("2027-03-01");
  });
});

describe("monthIndex", () => {
  it("should count months since the first scrobble's", () => {
    expect(monthIndex("2007-12-31")).toBe(0);
    expect(monthIndex("2012-10-14")).toBe(4 * 12 + 10);
  });
});

describe("dayInMonth", () => {
  it("should keep the date in the month at an index", () => {
    expect(dayInMonth(1, "2012-10-14")).toBe("2008-01-14");
  });

  it("should count from the first scrobble's month", () => {
    expect(dayInMonth(0, "2012-10-14")).toBe("2007-12-14");
  });

  it("should end a shorter month at its last day", () => {
    expect(dayInMonth(monthIndex("2012-02-01"), "2012-10-31")).toBe(
      "2012-02-29",
    );
  });
});

describe("firstOfMonth", () => {
  it("should start the first scrobble's month on its day", () => {
    expect(firstOfMonth("2007-12")).toBe("2007-12-18");
    expect(firstOfMonth("2012-10")).toBe("2012-10-01");
  });
});

describe("dayIndex", () => {
  it("should count from the month's first day of the history", () => {
    expect(dayIndex("2007-12-20")).toBe(2);
    expect(dayIndex("2012-10-02")).toBe(1);
  });
});

describe("labels", () => {
  it("should name the day, its month and its length", () => {
    expect(fullDayLabel("2012-10-14")).toBe("Sun, Oct 14, 2012");
    expect(monthLabel("2012-10")).toBe("Oct 2012");
    expect(monthOf("2012-10-14")).toBe("2012-10");
  });
});
