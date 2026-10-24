import Link from "next/link";
import { use } from "react";

import type { DayInYear, GetOnThisDayResult } from "@/actions/lastfm";
import { Skeleton } from "@/components/Skeleton";
import { formatPlays } from "@/lib/formatNumber";

export interface OnThisDayTeaserProps {
  onThisDay: Promise<GetOnThisDayResult>;
}

const busiest = (years: readonly DayInYear[]) =>
  years.reduce<Required<DayInYear> | undefined>(
    (busiest, { top, ...year }) =>
      top && year.count > (busiest?.count ?? 0) ? { ...year, top } : busiest,
    undefined,
  );

export const OnThisDayTeaser = ({ onThisDay }: OnThisDayTeaserProps) => {
  const result = use(onThisDay);
  const year = result.status === "ok" ? busiest(result.days.years) : undefined;

  if (year === undefined) return null;

  return (
    <p>
      On this day in {year.year}: {year.top.track} &ndash;{" "}
      <em>{year.top.artist}</em> ({formatPlays(year.count)}). See{" "}
      <Link href="/listening/on-this-day">every year</Link>.
    </p>
  );
};

export const OnThisDayTeaserSkeleton = () => (
  <p aria-hidden="true">
    <Skeleton width={36} />
  </p>
);
