import type { DayInYear, PlayedYear } from "@/actions/listening";
import { formatPlays } from "@/lib/formatNumber";

export const busiestYear = (years: readonly DayInYear[]) =>
  years.reduce<PlayedYear | undefined>(
    (busiest, year) =>
      year.top && year.count > (busiest?.count ?? 0) ? year : busiest,
    undefined,
  );

// Left out when the track is all that played, since the day's count already says it.
export const topTrackPlays = ({ top, count }: PlayedYear) =>
  top.plays < count ? `(${formatPlays(top.plays)})` : undefined;
