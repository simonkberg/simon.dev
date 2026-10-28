import { describe, expect, it } from "vitest";

import { clockTime, dayStart, nextMidnight, todayLabel } from "./dates";

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
