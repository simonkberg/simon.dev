import { describe, expect, it } from "vitest";

import {
  addDays,
  dayInMonth,
  fullDayLabel,
  monthIndex,
  monthLabel,
  monthOf,
  parseDay,
  yearBefore,
} from "./days";

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
  it("should count months since January of the first year", () => {
    expect(monthIndex("2007-01-01")).toBe(0);
    expect(monthIndex("2012-10-14")).toBe(5 * 12 + 9);
  });
});

describe("dayInMonth", () => {
  it("should keep the date in the month at an index", () => {
    expect(dayInMonth(0, "2012-10-14")).toBe("2007-01-14");
  });

  it("should end a shorter month at its last day", () => {
    expect(dayInMonth(monthIndex("2012-02-01"), "2012-10-31")).toBe(
      "2012-02-29",
    );
  });
});

describe("labels", () => {
  it("should name the day, its month and its length", () => {
    expect(fullDayLabel("2012-10-14")).toBe("Sun, Oct 14, 2012");
    expect(monthLabel("2012-10-14")).toBe("Oct 2012");
    expect(monthOf("2012-10-14")).toBe("2012-10");
  });
});
