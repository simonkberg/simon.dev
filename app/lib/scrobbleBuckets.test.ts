import { describe, expect, it } from "vitest";

import {
  monthBuckets,
  monthDayBuckets,
  periodStart,
  sameDayBuckets,
  scrobbleBuckets,
  yearBuckets,
} from "./scrobbleBuckets";

const now = new Date("2026-10-23T09:15:00Z");

describe("scrobbleBuckets", () => {
  it("should end with today, split at Stockholm midnight", () => {
    const buckets = scrobbleBuckets("7day", now);

    expect(buckets).toHaveLength(7);
    expect(buckets.at(0)).toEqual({
      label: "Oct 17",
      from: new Date("2026-10-16T22:00:00Z"),
      to: new Date("2026-10-17T22:00:00Z"),
    });
    expect(buckets.at(-1)).toEqual({
      label: "Oct 23",
      from: new Date("2026-10-22T22:00:00Z"),
      to: new Date("2026-10-23T22:00:00Z"),
    });
  });

  it("should take the date in Stockholm, not UTC", () => {
    const buckets = scrobbleBuckets("7day", new Date("2026-10-22T22:30:00Z"));

    expect(buckets.at(-1)?.label).toBe("Oct 23");
  });

  it("should give a day that changes the clock its true length", () => {
    const buckets = scrobbleBuckets("1month", new Date("2026-10-26T12:00:00Z"));

    expect(buckets.find(({ label }) => label === "Oct 25")).toEqual({
      label: "Oct 25",
      from: new Date("2026-10-24T22:00:00Z"),
      to: new Date("2026-10-25T23:00:00Z"),
    });
  });

  it("should split weeks at Monday", () => {
    const buckets = scrobbleBuckets("3month", now);

    expect(buckets).toHaveLength(13);
    expect(buckets.at(-1)).toEqual({
      label: "Oct 19",
      from: new Date("2026-10-18T22:00:00Z"),
      to: new Date("2026-10-25T23:00:00Z"),
    });
  });

  it("should step back through months across a year", () => {
    const buckets = scrobbleBuckets("12month", now);

    expect(buckets.map(({ label }) => label)).toEqual([
      "Nov 2025",
      "Dec 2025",
      "Jan 2026",
      "Feb 2026",
      "Mar 2026",
      "Apr 2026",
      "May 2026",
      "Jun 2026",
      "Jul 2026",
      "Aug 2026",
      "Sep 2026",
      "Oct 2026",
    ]);
    expect(buckets.at(1)).toMatchObject({
      from: new Date("2025-11-30T23:00:00Z"),
      to: new Date("2025-12-31T23:00:00Z"),
    });
  });
});

describe("periodStart", () => {
  it("should start where the period's first bucket does", () => {
    expect(periodStart("3month", now)).toEqual(
      scrobbleBuckets("3month", now)[0]?.from,
    );
  });
});

describe("yearBuckets", () => {
  it("should run from the first scrobble's year to this year", () => {
    const buckets = yearBuckets(now);

    expect(buckets).toHaveLength(2026 - 2007 + 1);
    expect(buckets.at(0)).toEqual({
      label: "2007",
      from: new Date("2006-12-31T23:00:00Z"),
      to: new Date("2007-12-31T23:00:00Z"),
    });
    expect(buckets.at(-1)?.label).toBe("2026");
  });
});

describe("monthBuckets", () => {
  it("should run from the first scrobble's month to this month", () => {
    const buckets = monthBuckets(now);

    expect(buckets).toHaveLength((2026 - 2007) * 12 - 1);
    expect(buckets.at(0)).toEqual({
      label: "Dec 2007",
      from: new Date("2007-11-30T23:00:00Z"),
      to: new Date("2007-12-31T23:00:00Z"),
    });
    expect(buckets.at(-1)?.label).toBe("Oct 2026");
  });
});

describe("monthDayBuckets", () => {
  it("should cover every day of a past month", () => {
    const buckets = monthDayBuckets("2012-02-01", now);

    expect(buckets).toHaveLength(29);
    expect(buckets.at(0)).toEqual({
      label: "Feb 1",
      from: new Date("2012-01-31T23:00:00Z"),
      to: new Date("2012-02-01T23:00:00Z"),
    });
    expect(buckets.at(-1)?.label).toBe("Feb 29");
  });

  it("should start at the given day", () => {
    const buckets = monthDayBuckets("2007-12-18", now);

    expect(buckets).toHaveLength(14);
    expect(buckets.at(0)?.label).toBe("Dec 18");
  });

  it("should end today in the current month", () => {
    const buckets = monthDayBuckets("2026-10-01", now);

    expect(buckets).toHaveLength(23);
    expect(buckets.at(-1)?.label).toBe("Oct 23");
  });
});

describe("sameDayBuckets", () => {
  it("should cover today's Stockholm date in each past year, newest first", () => {
    expect(sameDayBuckets(now).slice(0, 2)).toEqual([
      {
        label: "2025",
        from: new Date("2025-10-22T22:00:00Z"),
        to: new Date("2025-10-23T22:00:00Z"),
      },
      {
        label: "2024",
        from: new Date("2024-10-22T22:00:00Z"),
        to: new Date("2024-10-23T22:00:00Z"),
      },
    ]);
  });

  it("should end a month's last day on the next month's first", () => {
    const [bucket] = sameDayBuckets(new Date("2026-10-31T12:00:00Z"));

    expect(bucket).toMatchObject({
      from: new Date("2025-10-30T23:00:00Z"),
      to: new Date("2025-10-31T23:00:00Z"),
    });
  });

  it.each([
    ["2026-10-23T12:00:00Z", "2008"],
    ["2026-12-18T12:00:00Z", "2007"],
  ])("on %s, should start at the first scrobble", (date, first) => {
    expect(sameDayBuckets(new Date(date)).at(-1)?.label).toBe(first);
  });

  it("should skip years without February 29", () => {
    const buckets = sameDayBuckets(new Date("2024-02-29T12:00:00Z"));

    expect(buckets.map(({ label }) => label)).toEqual([
      "2020",
      "2016",
      "2012",
      "2008",
    ]);
  });
});
