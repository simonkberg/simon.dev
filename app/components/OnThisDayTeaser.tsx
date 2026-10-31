import Link from "next/link";
import { use } from "react";

import type { GetOnThisDayResult } from "@/actions/listening";
import { Skeleton } from "@/components/Skeleton";
import { formatPlays } from "@/lib/formatNumber";
import { busiestYear, topTrackPlays } from "@/lib/onThisDay";

export interface OnThisDayTeaserProps {
  onThisDay: Promise<GetOnThisDayResult>;
}

export const OnThisDayTeaser = ({ onThisDay }: OnThisDayTeaserProps) => {
  const result = use(onThisDay);
  const year =
    result.status === "ok" ? busiestYear(result.days.years) : undefined;

  if (year === undefined) return null;

  const trackPlays = topTrackPlays(year);

  return (
    <div className="flashback">
      <strong className="flashback-title">
        On this day in {year.year} ({formatPlays(year.count)})
      </strong>
      <p>
        {year.top.track} &ndash; <em>{year.top.artist}</em>
        {trackPlays && ` ${trackPlays}`}. See&nbsp;
        <Link href="/listening/on-this-day">every&nbsp;year</Link>.
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
