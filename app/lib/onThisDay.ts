import type { DayInYear, PlayedYear } from "@/actions/lastfm";

export const busiestYear = (years: readonly DayInYear[]) =>
  years.reduce<PlayedYear | undefined>(
    (busiest, year) =>
      year.top && year.count > (busiest?.count ?? 0) ? year : busiest,
    undefined,
  );
