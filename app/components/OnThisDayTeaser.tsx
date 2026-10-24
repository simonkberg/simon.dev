import Link from "next/link";
import { use } from "react";

import type {
  DayInYear,
  GetOnThisDayResult,
  PlayedYear,
} from "@/actions/lastfm";
import { Skeleton } from "@/components/Skeleton";
import { formatPlays } from "@/lib/formatNumber";

export interface OnThisDayTeaserProps {
  onThisDay: Promise<GetOnThisDayResult>;
}

const busiest = (years: readonly DayInYear[]) =>
  years.reduce<PlayedYear | undefined>(
    (busiest, year) =>
      year.top && year.count > (busiest?.count ?? 0) ? year : busiest,
    undefined,
  );

export const OnThisDayTeaser = ({ onThisDay }: OnThisDayTeaserProps) => {
  const result = use(onThisDay);
  const year = result.status === "ok" ? busiest(result.days.years) : undefined;

  if (year === undefined) return null;

  return (
    <div className="flashback">
      <strong className="flashback-title">
        On this day in {year.year} ({formatPlays(year.count)})
      </strong>
      <p>
        {year.top.track} &ndash; <em>{year.top.artist}</em>. See{" "}
        <Link href="/listening/on-this-day">every year</Link>.
      </p>
    </div>
  );
};

export const OnThisDayTeaserSkeleton = () => (
  <div className="flashback" aria-hidden="true">
    <span className="flashback-title">
      <Skeleton width={16} />
    </span>
    <p>
      <Skeleton width={36} />
    </p>
  </div>
);
