import { config } from "@/config";

export const timeZone = "Europe/Stockholm";

/** A Stockholm calendar date, as "YYYY-MM-DD". */
export type Day = `${number}-${number}-${number}`;
export type Month = `${number}-${number}`;

const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

// The instant whose UTC reading matches Stockholm's wall clock at `instant`.
function localTime(instant: number): number {
  const parts = wallClock.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
}

/** Stockholm's wall clock at `instant`, read through the UTC getters. */
export const localDate = (instant: Date) =>
  new Date(localTime(instant.getTime()));

// Date.UTC normalizes overflowing days and months, so callers can step by subtracting.
export function midnight(year: number, month: number, day: number): Date {
  const utc = Date.UTC(year, month, day);
  const guess = utc - (localTime(utc) - utc);
  return new Date(utc - (localTime(guess) - guess));
}

export const dayLabel = new Intl.DateTimeFormat("en-US", {
  timeZone,
  month: "short",
  day: "numeric",
});

const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" });

/** Stockholm's wall clock, like "2026-10-25 00:30". */
export const clockTime = (instant: Date) =>
  localDate(instant).toISOString().slice(0, 16).replace("T", " ");

/** The Stockholm date at `now`, as "YYYY-MM-DD". */
export const localDay = (now: Date) => clockTime(now).slice(0, 10) as Day;

/** Today in Stockholm, like "Sunday 2026-10-25". */
export const todayLabel = (now: Date) =>
  `${weekday.format(now)} ${localDay(now)}`;

/** The start of tomorrow in Stockholm. */
export function nextMidnight(now: Date): Date {
  const today = localDate(now);
  return midnight(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate() + 1,
  );
}

/** The Stockholm midnight starting a "YYYY-MM-DD" date, or `offset` days after it. */
export function dayStart(date: string, offset = 0): Date {
  const d = new Date(date);
  return midnight(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offset);
}

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

/** The date as typed, when it is a day of the history: from `firstDay` until today. */
export function inHistory(value: string, today: Day): Day | undefined {
  const day = parseDay(value);
  return day !== undefined && day >= firstDay && day <= today ? day : undefined;
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
