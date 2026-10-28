export const timeZone = "Europe/Stockholm";

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

/** Today in Stockholm, like "Sunday 2026-10-25". */
export const todayLabel = (now: Date) =>
  `${weekday.format(now)} ${clockTime(now).slice(0, 10)}`;

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
