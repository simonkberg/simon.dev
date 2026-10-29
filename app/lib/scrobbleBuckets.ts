import {
  type Month,
  dayLabel,
  dayStart,
  firstYear,
  inHistory,
  localDate,
  localDay,
  midnight,
  monthIndex,
  timeZone,
} from "@/lib/dates";
import type { Period } from "@/lib/periods";

export interface ScrobbleBucket {
  label: string;
  from: Date;
  to: Date;
}

const labels = {
  day: dayLabel,
  week: dayLabel,
  month: new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    year: "numeric",
  }),
  year: new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }),
};

type BucketUnit = keyof typeof labels;

export const bucketUnits = {
  "7day": "day",
  "1month": "day",
  "3month": "week",
  "6month": "week",
  "12month": "month",
  overall: "year",
} as const satisfies Record<Period, BucketUnit>;

const bucketCounts = {
  "7day": 7,
  "1month": 30,
  "3month": 13,
  "6month": 26,
  "12month": 12,
} as const satisfies Record<Exclude<Period, "overall">, number>;

function start(unit: BucketUnit, today: Date, offset: number): Date {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const day = today.getUTCDate();
  switch (unit) {
    case "day":
      return midnight(year, month, day - offset);
    case "week":
      // Weeks start on Monday.
      return midnight(
        year,
        month,
        day - ((today.getUTCDay() + 6) % 7) - offset * 7,
      );
    case "month":
      return midnight(year, month - offset, 1);
    case "year":
      return midnight(year - offset, 0, 1);
  }
}

function buckets(
  unit: BucketUnit,
  count: number,
  today: Date,
): ScrobbleBucket[] {
  // Each bucket starts where the previous one ended, so every edge is computed once.
  let from = start(unit, today, count - 1);
  return Array.from({ length: count }, (_, index) => {
    const to = start(unit, today, count - 2 - index);
    const bucket = { label: labels[unit].format(from), from, to };
    from = to;
    return bucket;
  });
}

/** Calendar days, weeks or months in Stockholm, oldest first, ending with the current one. */
export function scrobbleBuckets(
  period: Exclude<Period, "overall">,
  now: Date,
): ScrobbleBucket[] {
  return buckets(bucketUnits[period], bucketCounts[period], localDate(now));
}

/** Where a period's first bucket starts. */
export function periodStart(
  period: Exclude<Period, "overall">,
  now: Date,
): Date {
  return start(bucketUnits[period], localDate(now), bucketCounts[period] - 1);
}

/** Calendar years in Stockholm, from `since` to the current one. */
export function yearBuckets(since: number, now: Date): ScrobbleBucket[] {
  const today = localDate(now);
  const count = today.getUTCFullYear() - since + 1;
  return buckets("year", count, today);
}

/** Today's Stockholm date in each past year of the history, newest first. */
export function sameDayBuckets(now: Date): ScrobbleBucket[] {
  const today = localDay(now);
  const year = Number(today.slice(0, 4));
  return Array.from(
    { length: year - firstYear },
    (_, index) => `${year - 1 - index}${today.slice(4)}`,
  ).flatMap((date) => {
    // February 29 only comes around in leap years.
    const day = inHistory(date, today);
    return day === undefined
      ? []
      : [{ label: day.slice(0, 4), from: dayStart(day), to: dayStart(day, 1) }];
  });
}

/** Calendar months in Stockholm, one per tape index, up to the current one. */
export function monthBuckets(now: Date): ScrobbleBucket[] {
  return buckets("month", monthIndex(localDay(now)) + 1, localDate(now));
}

/** The Stockholm days of a "YYYY-MM" month, up to today in the current one. */
export function monthDayBuckets(month: Month, now: Date): ScrobbleBucket[] {
  const first = new Date(month);
  const monthEnd = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  );
  const today = localDate(now);
  const last = monthEnd < today ? monthEnd : today;
  return buckets("day", last.getUTCDate(), last);
}
