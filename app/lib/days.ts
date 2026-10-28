import { config } from "@/config";
import type { Day, Month } from "@/lib/dates";

/** The first day time travel reaches, the year Last.fm's history starts. */
export const firstDay: Day = `${config.lastfmSince}-01-01`;

// A Day read as UTC midnight, so the UTC getters give its calendar date.
const utc = (day: Day) => new Date(`${day}T00:00:00Z`);

const toDay = (instant: number) =>
  new Date(instant).toISOString().slice(0, 10) as Day;

/** The date as typed, when it names a real calendar day. */
export function parseDay(value: string): Day | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const day = value as Day;
  const date = utc(day);
  return !Number.isNaN(date.getTime()) && toDay(date.getTime()) === day
    ? day
    : undefined;
}

export const addDays = (day: Day, days: number): Day => {
  const date = utc(day);
  return toDay(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + days,
    ),
  );
};

/** The same date a year earlier; February 29 becomes March 1. */
export const yearBefore = (day: Day): Day => {
  const date = utc(day);
  return toDay(
    Date.UTC(date.getUTCFullYear() - 1, date.getUTCMonth(), date.getUTCDate()),
  );
};

/** Months since January of the first year: the tape's index of the day's month. */
export const monthIndex = (day: Day) => {
  const date = utc(day);
  return (date.getUTCFullYear() - config.lastfmSince) * 12 + date.getUTCMonth();
};

/** The day of the month at `index` nearest `day`'s date in its own month. */
export function dayInMonth(index: number, day: Day): Day {
  const year = config.lastfmSince + Math.floor(index / 12);
  const month = index % 12;
  const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return toDay(Date.UTC(year, month, Math.min(utc(day).getUTCDate(), length)));
}

export const daysInMonth = (day: Day) => {
  const date = utc(day);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
};

const longLabel = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const monthFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  year: "numeric",
});

/** Like "Sun, Oct 14, 2012". */
export const fullDayLabel = (day: Day) => longLabel.format(utc(day));

/** Like "Oct 2012". */
export const monthLabel = (day: Day) => monthFormat.format(utc(day));

/** The "YYYY-MM" month the day falls in. */
export const monthOf = (day: Day) => day.slice(0, 7) as Month;
